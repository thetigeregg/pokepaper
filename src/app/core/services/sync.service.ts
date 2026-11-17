import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import type {
  SyncChange,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
} from '@pokepaper/shared';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { OutboxEntry, StorageEngine, StorageScope } from '../data/storage-engine';
import { StorageEngineFactory } from '../data/storage-engine.factory';
import { SYNC_ENTITY_APPLIERS, SyncEntityApplier } from '../data/sync-entity-applier';
import { SyncOutboxWriteRequest, SyncOutboxWriter } from '../data/sync-outbox-writer';

export const SYNC_INTERVAL_MS = 30_000;
export const PULL_CURSOR_KEY = 'pullCursor';
/** Upper bound on pull pages per sync cycle, so a runaway `hasMore` can't spin forever. */
const MAX_PULL_PAGES = 50;

/**
 * - `idle`: last cycle succeeded (or none has run yet)
 * - `syncing`: a cycle is in flight
 * - `offline`: the browser reports no connectivity; local data keeps working
 * - `unauthorized`: the server rejected the session (401). Syncing stops
 *   until `resumeAfterReauth()` is called; queued outbox writes are kept.
 * - `error`: the last cycle failed for another reason; retried on the next trigger
 */
export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'unauthorized' | 'error';

/**
 * Local-first sync loop, ported from go-gather's `SyncService` and
 * generalised to any entity type: push the outbox (oldest first), then pull
 * the server change log from the stored cursor and hand each change to the
 * `SyncEntityApplier` registered for its entity type.
 *
 * Triggers: app start, a fixed interval, the browser `online` event, and
 * every local write (via `SyncOutboxWriter.syncNow`).
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

  private readonly _status = signal<SyncStatus>('idle');
  readonly status = this._status.asReadonly();

  private syncInFlight: Promise<void> | null = null;
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

  async enqueueOperation(request: SyncOutboxWriteRequest): Promise<void> {
    const entry: OutboxEntry = {
      opId: request.opId ?? crypto.randomUUID(),
      entityType: request.entityType,
      entityId: request.entityId,
      operation: request.operation,
      payload: request.payload,
      clientTimestamp: request.clientTimestamp ?? new Date().toISOString(),
      createdAt: new Date().toISOString(),
      attemptCount: 0,
      lastError: null,
    };

    await this.engine.putOutboxEntry(entry);
    this.onOutboxEntryEnqueued(entry);
    void this.syncNow();
  }

  onOutboxEntryEnqueued(_entry: OutboxEntry): void {
    // Observability hook; no logging service yet.
  }

  /** Runs one push + pull cycle. Concurrent callers share the in-flight cycle. */
  syncNow(): Promise<void> {
    if (this.syncInFlight) {
      return this.syncInFlight;
    }

    if (this._status() === 'unauthorized') {
      return Promise.resolve();
    }

    if (!navigator.onLine) {
      this._status.set('offline');
      return Promise.resolve();
    }

    this.syncInFlight = this.runCycle().finally(() => {
      this.syncInFlight = null;
    });

    return this.syncInFlight;
  }

  private async runCycle(): Promise<void> {
    this._status.set('syncing');

    try {
      await this.pushOutbox();
      await this.pullChanges();
      this._status.set('idle');
    } catch (error: unknown) {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        this._status.set('unauthorized');
        return;
      }

      // Best effort: retried on the next interval/online/write trigger.
      this._status.set(navigator.onLine ? 'error' : 'offline');
    }
  }

  private async pushOutbox(): Promise<void> {
    const entries = await this.engine.listOutboxOrderedByCreatedAt();
    if (entries.length === 0) {
      return;
    }

    const body: SyncPushRequest = {
      operations: entries.map((entry) => ({
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

    for (const failure of response.results.filter((result) => result.status === 'failed')) {
      const existing = await this.engine.getOutboxEntry(failure.opId);
      if (!existing) {
        continue;
      }

      await this.engine.putOutboxEntry({
        ...existing,
        attemptCount: existing.attemptCount + 1,
        lastError: failure.message ?? 'Failed to push operation.',
      });
    }
  }

  private async pullChanges(): Promise<void> {
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

    const scopes = new Set<StorageScope>(['syncMeta']);
    for (const change of applicable) {
      for (const scope of this.appliers.get(change.entityType)?.scopes ?? []) {
        scopes.add(scope);
      }
    }

    await this.engine.runInTransaction([...scopes], async () => {
      for (const change of applicable) {
        await this.appliers.get(change.entityType)?.apply(this.engine, change);
      }

      if (nextCursor !== previousCursor) {
        await this.engine.putSyncMeta({ key: PULL_CURSOR_KEY, value: nextCursor });
      }
    });
  }
}
