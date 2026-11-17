import { Injectable, inject } from '@angular/core';
import { DEFAULT_SETTINGS, SETTINGS_ENTITY_ID, type UserSettings } from '@pokepaper/shared';
import { OutboxEntry, StorageEngine, StorageScope } from './storage-engine';
import { StorageEngineFactory } from './storage-engine.factory';
import { SYNC_OUTBOX_WRITER, SyncOutboxWriter } from './sync-outbox-writer';

/**
 * Local-first read/write surface for synced user data. Every mutating method
 * writes the local `StorageEngine` scope *and* enqueues an `outbox` entry in
 * one transaction, then fires a best-effort sync attempt. Reads go straight
 * to the local engine (instant, offline-capable).
 *
 * Ported from go-gather's repository of the same name. Collection and deck
 * writes follow the same `withOutboxTransaction` + `queueOperation` pattern.
 */
@Injectable({ providedIn: 'root' })
export class LocalUserDataRepository {
  private readonly storageEngineFactory = inject(StorageEngineFactory);
  private readonly outboxWriter = inject<SyncOutboxWriter | null>(SYNC_OUTBOX_WRITER, {
    optional: true,
  });

  // `STORAGE_ENGINE`'s DI factory throws until `StorageEngineFactory.initialize()`
  // resolves, and this repository can be constructed inside the same
  // `provideAppInitializer` callback that calls `initialize()` (see main.ts),
  // so the engine is resolved lazily per call.
  private get engine(): StorageEngine {
    return this.storageEngineFactory.getEngine();
  }

  async getSettings(): Promise<UserSettings> {
    const stored = await this.engine.getSettings();
    return { ...DEFAULT_SETTINGS, ...stored };
  }

  async updateSettings(settings: UserSettings): Promise<void> {
    const clientTimestamp = new Date().toISOString();

    await this.withOutboxTransaction(['settings'], async () => {
      await this.engine.putSettings(settings);
      await this.queueOperation(
        'settings',
        SETTINGS_ENTITY_ID,
        'upsert',
        settings,
        clientTimestamp
      );
    });
  }

  private withOutboxTransaction<T>(
    scope: readonly StorageScope[],
    action: () => Promise<T>
  ): Promise<T> {
    if (!this.outboxWriter) {
      return action();
    }

    return this.engine.runInTransaction([...scope, 'outbox'], action).then((result) => {
      this.requestSyncNow();
      return result;
    });
  }

  private queueOperation(
    entityType: OutboxEntry['entityType'],
    entityId: string,
    operation: OutboxEntry['operation'],
    payload: unknown,
    clientTimestamp: string
  ): Promise<void> {
    if (!this.outboxWriter) {
      return Promise.resolve();
    }

    const entry: OutboxEntry = {
      opId: crypto.randomUUID(),
      entityType,
      entityId,
      operation,
      payload,
      clientTimestamp,
      createdAt: new Date().toISOString(),
      attemptCount: 0,
      lastError: null,
    };

    return this.engine.putOutboxEntry(entry).then(() => {
      try {
        this.outboxWriter?.onOutboxEntryEnqueued?.(entry);
      } catch {
        // Observability hook failure shouldn't break the write.
      }
    });
  }

  private requestSyncNow(): void {
    if (!this.outboxWriter?.syncNow) {
      return;
    }

    try {
      void this.outboxWriter.syncNow().catch(() => undefined);
    } catch {
      // Best-effort: sync errors are handled inside SyncService.
    }
  }
}
