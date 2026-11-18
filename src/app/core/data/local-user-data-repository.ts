import { Injectable, inject } from '@angular/core';
import {
  collectionEntryId,
  DEFAULT_SETTINGS,
  MAX_COLLECTION_QUANTITY,
  SETTINGS_ENTITY_ID,
  type CollectionEntry,
  type CollectionTarget,
  type UserSettings,
} from '@pokepaper/shared';
import { OutboxEntry, StorageEngine, StorageScope } from './storage-engine';
import { StorageEngineFactory } from './storage-engine.factory';
import { SYNC_OUTBOX_WRITER, SyncOutboxWriter } from './sync-outbox-writer';

/**
 * Local-first read/write surface for synced user data. Every mutating method
 * writes the local `StorageEngine` scope *and* enqueues an `outbox` entry in
 * one transaction, then fires a best-effort sync attempt. Reads go straight
 * to the local engine (instant, offline-capable).
 *
 * Ported from go-gather's repository of the same name. Deck writes will
 * follow the same `withOutboxTransaction` + `queueOperation` pattern.
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

  listCollection(): Promise<CollectionEntry[]> {
    return this.engine.listCollectionEntries();
  }

  /**
   * Sets how many copies of `target` the user owns (0 to
   * `MAX_COLLECTION_QUANTITY`). 0 deletes the entry, locally and on the server.
   */
  async setCollectionQuantity(target: CollectionTarget, quantity: number): Promise<void> {
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_COLLECTION_QUANTITY) {
      throw new RangeError(
        `Collection quantity must be an integer from 0 to ${String(MAX_COLLECTION_QUANTITY)}`
      );
    }
    const key = collectionEntryId(target);
    const clientTimestamp = new Date().toISOString();

    await this.withOutboxTransaction(['collection'], async () => {
      if (quantity === 0) {
        await this.engine.deleteCollectionEntry(key);
        await this.queueOperation('collectionEntry', key, 'delete', null, clientTimestamp);
        return;
      }
      const entry: CollectionEntry = {
        region: target.region,
        cardId: target.cardId,
        setId: target.setId,
        variant: target.variant,
        language: target.language,
        quantity,
      };
      await this.engine.putCollectionEntry(entry);
      await this.queueOperation('collectionEntry', key, 'upsert', entry, clientTimestamp);
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
