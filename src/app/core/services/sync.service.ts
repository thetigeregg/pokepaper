import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import type {
  SyncChange,
  SyncEntityType,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
} from '@pokepaper/shared';
import { Observable, Subject, firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { OutboxEntry, StorageEngine, StorageScope } from '../data/storage-engine';
import { StorageEngineFactory } from '../data/storage-engine.factory';
import { SYNC_ENTITY_APPLIERS, SyncEntityApplier } from '../data/sync-entity-applier';
import { SyncOutboxWriter } from '../data/sync-outbox-writer';

export const SYNC_INTERVAL_MS = 30_000;
export const PULL_CURSOR_KEY = 'pullCursor';
/** syncMeta key recording which entity types this build could apply when the cursor was last advanced. */
export const SYNC_ENTITY_TYPES_KEY = 'syncEntityTypes';
/** Max operations per push request. */
export const PUSH_BATCH_SIZE = 200;
/** An operation the server rejects this many times is dropped (see `pushOutbox`). */
export const MAX_PUSH_ATTEMPTS = 5;
/** Upper bound on pull pages per sync cycle, so a runaway `hasMore` can't spin forever. */
const MAX_PULL_PAGES = 50;

/**
 * - `idle`: last cycle succeeded with nothing left to push (or none has run yet)
 * - `syncing`: a cycle is in flight
 * - `offline`: the browser reports no connectivity; local data keeps working
 * - `unauthorized`: the server rejected the session (401). Syncing stops
 *   until `resumeAfterReauth()` is called; queued outbox writes are kept.
 * - `error`: the last cycle failed, or the server rejected some operations
 *   that are still queued for retry
 */
export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'unauthorized' | 'error';

function entityKey(entityType: string, entityId: string): string {
  return `${entityType}\u0000${entityId}`;
}

/**
 * Local-first sync loop, ported from go-gather's `SyncService` and
 * generalised to any entity type: push the outbox (oldest first), then pull
 * the server change log from the stored cursor and hand each change to the
 * `SyncEntityApplier` registered for its entity type.
 *
 * Triggers: app start, a fixed interval, the browser `online` event, and
 * every local write (via `SyncOutboxWriter.syncNow`). A trigger that arrives
 * mid-cycle schedules one more cycle, so a write made during a sync is pushed
 * right after it instead of waiting for the next interval.
 *
 * Conflict rules (see docs/sync.md):
 * - Operations carry full entity state, so only the newest queued operation
 *   per entity is pushed; older ones are superseded and dropped.
 * - Pulled changes never overwrite an entity that still has a queued local
 *   operation: the local write wins until it has been pushed, and the server
 *   echoes it back in a later pull.
 * - An operation the server rejects `MAX_PUSH_ATTEMPTS` times is dropped and
 *   the pull cursor is reset, so a full re-pull restores the server's state.
 */
@Injectable({ providedIn: 'root' })
export class SyncService implements SyncOutboxWriter {
  private readonly http = inject(HttpClient);
  private readonly storageEngineFactory = inject(StorageEngineFactory);
  private readonly appliers = new Map<string, SyncEntityApplier>(
    (inject(SYNC_ENTITY_APPLIERS, { optional: true }) ?? []).map((applier) => [
      applier.entityType,
      applier,
    ])
  );
  private readonly knownEntityTypes = [...this.appliers.keys()].sort().join(',');

  private readonly _status = signal<SyncStatus>('idle');
  readonly status = this._status.asReadonly();

  private readonly _rejectedOperations = signal(0);
  /** Operations dropped this session after the server rejected them `MAX_PUSH_ATTEMPTS` times. */
  readonly rejectedOperations = this._rejectedOperations.asReadonly();

  private readonly _dataChanged$ = new Subject<ReadonlySet<SyncEntityType>>();
  /** Emits the entity types a pull just wrote locally, so screens can reload. */
  readonly dataChanged$: Observable<ReadonlySet<SyncEntityType>> =
    this._dataChanged$.asObservable();

  private syncInFlight: Promise<void> | null = null;
  private rerunRequested = false;
  private intervalId: number | null = null;

  /**
   * Resolved lazily (not as a field initializer) since `SyncService` is
   * constructed as part of the same app-initializer chain that calls
   * `StorageEngineFactory.initialize()`.
   */
  private get engine(): StorageEngine {
    return this.storageEngineFactory.getEngine();
  }

  initialize(): void {
    if (this.intervalId !== null) {
      return;
    }

    void this.syncNow();
    this.intervalId = window.setInterval(() => void this.syncNow(), SYNC_INTERVAL_MS);
    window.addEventListener('online', () => void this.syncNow());
    window.addEventListener('offline', () => {
      if (this._status() !== 'unauthorized') {
        this._status.set('offline');
      }
    });
  }

  /** Clears the `unauthorized` stop after a successful sign-in and syncs immediately. */
  resumeAfterReauth(): Promise<void> {
    if (this._status() === 'unauthorized') {
      this._status.set('idle');
    }

    return this.syncNow();
  }

  onOutboxEntryEnqueued(_entry: OutboxEntry): void {
    // Observability hook; no logging service yet.
  }

  /**
   * Runs push + pull. If a cycle is already running, schedules one more cycle
   * after it and returns the in-flight promise, which settles once that
   * follow-up cycle has finished too.
   */
  syncNow(): Promise<void> {
    if (this.syncInFlight) {
      this.rerunRequested = true;
      return this.syncInFlight;
    }

    if (this._status() === 'unauthorized') {
      return Promise.resolve();
    }

    if (!navigator.onLine) {
      this._status.set('offline');
      return Promise.resolve();
    }

    this.syncInFlight = this.runCycles().finally(() => {
      this.syncInFlight = null;
    });

    return this.syncInFlight;
  }

  private async runCycles(): Promise<void> {
    do {
      this.rerunRequested = false;
      await this.runCycle();
    } while (this.shouldRunAgain());
  }

  /** Read through a method so the compiler doesn't narrow `rerunRequested`, which syncNow() sets during the await above. */
  private shouldRunAgain(): boolean {
    return this.rerunRequested && this._status() !== 'unauthorized' && navigator.onLine;
  }

  private async runCycle(): Promise<void> {
    this._status.set('syncing');

    try {
      const pendingFailures = await this.pushOutbox();
      await this.pullChanges();
      this._status.set(pendingFailures ? 'error' : 'idle');
    } catch (error: unknown) {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        this._status.set('unauthorized');
        return;
      }

      // Best effort: retried on the next interval/online/write trigger.
      this._status.set(navigator.onLine ? 'error' : 'offline');
    }
  }

  /** Pushes queued operations. Resolves true if rejected operations remain queued for retry. */
  private async pushOutbox(): Promise<boolean> {
    const entries = await this.dropSupersededOperations(
      await this.engine.listOutboxOrderedByCreatedAt()
    );

    let pendingFailures = false;
    for (let index = 0; index < entries.length; index += PUSH_BATCH_SIZE) {
      const batch = entries.slice(index, index + PUSH_BATCH_SIZE);
      if (await this.pushBatch(batch)) {
        pendingFailures = true;
      }
    }

    return pendingFailures;
  }

  /**
   * Operations carry full entity state, so for each entity only the newest
   * queued operation matters. Older ones are deleted unpushed: replaying them
   * could only reapply stale state (e.g. a previously rejected op landing
   * after a newer accepted one).
   */
  private async dropSupersededOperations(entries: OutboxEntry[]): Promise<OutboxEntry[]> {
    const newestByEntity = new Map<string, OutboxEntry>();
    for (const entry of entries) {
      newestByEntity.set(entityKey(entry.entityType, entry.entityId), entry);
    }

    const latest = entries.filter(
      (entry) => newestByEntity.get(entityKey(entry.entityType, entry.entityId)) === entry
    );
    if (latest.length !== entries.length) {
      const keep = new Set(latest.map((entry) => entry.opId));
      await this.engine.bulkDeleteOutbox(
        entries.filter((entry) => !keep.has(entry.opId)).map((entry) => entry.opId)
      );
    }

    return latest;
  }

  private async pushBatch(batch: OutboxEntry[]): Promise<boolean> {
    const body: SyncPushRequest = {
      operations: batch.map((entry) => ({
        opId: entry.opId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        operation: entry.operation,
        payload: entry.payload,
        clientTimestamp: entry.clientTimestamp,
      })),
    };

    const response = await firstValueFrom(
      this.http.post<SyncPushResponse>(`${environment.apiUrl}/api/sync/push`, body)
    );

    const ackedIds = response.results
      .filter((result) => result.status === 'applied' || result.status === 'duplicate')
      .map((result) => result.opId);

    if (ackedIds.length > 0) {
      await this.engine.bulkDeleteOutbox(ackedIds);
    }

    let pendingFailures = false;
    const rejected: OutboxEntry[] = [];

    for (const failure of response.results.filter((result) => result.status === 'failed')) {
      const existing = await this.engine.getOutboxEntry(failure.opId);
      if (!existing) {
        continue;
      }

      const updated: OutboxEntry = {
        ...existing,
        attemptCount: existing.attemptCount + 1,
        lastError: failure.message ?? 'Failed to push operation.',
      };

      if (updated.attemptCount >= MAX_PUSH_ATTEMPTS) {
        rejected.push(updated);
      } else {
        pendingFailures = true;
        await this.engine.putOutboxEntry(updated);
      }
    }

    if (rejected.length > 0) {
      await this.dropRejectedOperations(rejected);
    }

    return pendingFailures;
  }

  /**
   * Gives up on operations the server keeps rejecting. Their local writes no
   * longer match the server, so the pull cursor is reset in the same
   * transaction: the next pull replays the change log and restores the
   * server's state for those entities.
   */
  private async dropRejectedOperations(rejected: OutboxEntry[]): Promise<void> {
    await this.engine.runInTransaction(['outbox', 'syncMeta'], async () => {
      await this.engine.bulkDeleteOutbox(rejected.map((entry) => entry.opId));
      await this.engine.putSyncMeta({ key: PULL_CURSOR_KEY, value: '0' });
    });

    for (const entry of rejected) {
      console.error('sync.operation_rejected', {
        opId: entry.opId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        lastError: entry.lastError,
      });
    }
    this._rejectedOperations.update((count) => count + rejected.length);
  }

  private async pullChanges(): Promise<void> {
    await this.resetCursorIfEntityTypesChanged();

    for (let page = 0; page < MAX_PULL_PAGES; page += 1) {
      const cursor = (await this.engine.getSyncMeta(PULL_CURSOR_KEY))?.value ?? '0';

      const response = await firstValueFrom(
        this.http.post<SyncPullResponse>(`${environment.apiUrl}/api/sync/pull`, { cursor })
      );

      await this.applyPage(response.changes, response.cursor, cursor);

      if (!response.hasMore) {
        return;
      }
    }
  }

  /**
   * Changes for entity types this build has no applier for are skipped while
   * the cursor moves past them. When a build adds an applier, start over from
   * cursor 0 so those earlier changes are pulled again.
   */
  private async resetCursorIfEntityTypesChanged(): Promise<void> {
    const recorded = (await this.engine.getSyncMeta(SYNC_ENTITY_TYPES_KEY))?.value;
    if (recorded === this.knownEntityTypes) {
      return;
    }

    await this.engine.runInTransaction(['syncMeta'], async () => {
      await this.engine.putSyncMeta({ key: PULL_CURSOR_KEY, value: '0' });
      await this.engine.putSyncMeta({ key: SYNC_ENTITY_TYPES_KEY, value: this.knownEntityTypes });
    });
  }

  /** Applies one page of changes and advances the cursor in a single transaction. */
  private async applyPage(
    changes: SyncChange[],
    nextCursor: string,
    previousCursor: string
  ): Promise<void> {
    const applicable = changes.filter((change) => this.appliers.has(change.entityType));
    if (applicable.length === 0 && nextCursor === previousCursor) {
      return;
    }

    const scopes = new Set<StorageScope>(['syncMeta', 'outbox']);
    for (const change of applicable) {
      for (const scope of this.appliers.get(change.entityType)?.scopes ?? []) {
        scopes.add(scope);
      }
    }

    const changedTypes = new Set<SyncEntityType>();

    await this.engine.runInTransaction([...scopes], async () => {
      // Read inside the transaction so a local write can't slip in between
      // this check and the apply below.
      const pending = new Set(
        (await this.engine.listOutboxOrderedByCreatedAt()).map((entry) =>
          entityKey(entry.entityType, entry.entityId)
        )
      );

      for (const change of applicable) {
        if (pending.has(entityKey(change.entityType, change.entityId))) {
          continue;
        }

        await this.appliers.get(change.entityType)?.apply(this.engine, change);
        changedTypes.add(change.entityType);
      }

      if (nextCursor !== previousCursor) {
        await this.engine.putSyncMeta({ key: PULL_CURSOR_KEY, value: nextCursor });
      }
    });

    if (changedTypes.size > 0) {
      this._dataChanged$.next(changedTypes);
    }
  }
}
