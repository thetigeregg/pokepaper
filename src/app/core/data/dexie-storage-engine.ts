import { Injectable, inject } from '@angular/core';
import Dexie, { Table, Transaction } from 'dexie';
import type { UserSettings } from '@pokepaper/shared';
import { AppDb, SettingsRow } from './app-db';
import {
  ImageCacheRecord,
  OutboxEntry,
  StorageEngine,
  StorageScope,
  SyncMetaEntry,
} from './storage-engine';
import {
  isInsideStorageTransaction,
  runInsideStorageTransactionZone,
} from './storage-transaction-context';

interface ActiveTransaction {
  transaction: Transaction;
  scope: ReadonlySet<StorageScope>;
}

const SCOPE_TABLE_NAMES: Record<StorageScope, string> = {
  settings: 'settings',
  imageCache: 'imageCache',
  syncMeta: 'syncMeta',
  outbox: 'outbox',
};

const SETTINGS_ROW_ID = 1;

/**
 * IndexedDB-backed storage engine used on the web, delegating to the Dexie
 * schema in AppDb. Ported from go-gather.
 *
 * While a runInTransaction action is executing, operations on tables in the
 * transaction scope are routed through transaction-bound table handles rather
 * than relying solely on Dexie's PSD zone propagation. Zone echo across
 * multiple native awaits is unreliable in some environments (e.g. jsdom +
 * fake-indexeddb), causing PrematureCommitError; explicit routing keeps the
 * transaction alive and correctly scoped regardless.
 */
@Injectable({ providedIn: 'root' })
export class DexieStorageEngine implements StorageEngine {
  private readonly db = inject(AppDb);
  private activeTransaction: ActiveTransaction | null = null;
  private transactionQueue: Promise<unknown> = Promise.resolve();

  initialize(): Promise<void> {
    // Dexie opens lazily on first use; nothing to do here.
    return Promise.resolve();
  }

  runInTransaction<T>(scope: readonly StorageScope[], action: () => Promise<T>): Promise<T> {
    if (this.isNestedTransactionCall()) {
      return action();
    }

    const run = (): Promise<T> =>
      this.db.transaction('rw', this.tablesForScope(scope), (transaction) => {
        const previous = this.activeTransaction;
        this.activeTransaction = { transaction, scope: new Set(scope) };
        return runInsideStorageTransactionZone(() => action()).finally(() => {
          this.activeTransaction = previous;
        });
      });

    const queued = this.transactionQueue.then(run, run);
    this.transactionQueue = queued.catch(() => undefined);
    return queued;
  }

  async getSettings(): Promise<UserSettings | undefined> {
    const row = await this.settingsTable.get(SETTINGS_ROW_ID);
    if (!row) {
      return undefined;
    }

    const { id: _id, ...settings } = row;
    return settings;
  }

  putSettings(settings: UserSettings): Promise<void> {
    return this.settingsTable.put({ ...settings, id: SETTINGS_ROW_ID }).then(() => undefined);
  }

  getImage(key: string): Promise<ImageCacheRecord | undefined> {
    return this.imageCacheTable.get(key);
  }

  putImage(record: ImageCacheRecord): Promise<void> {
    return this.imageCacheTable.put(record).then(() => undefined);
  }

  deleteImage(key: string): Promise<void> {
    return this.imageCacheTable.delete(key);
  }

  clearImageCache(): Promise<void> {
    return this.imageCacheTable.clear();
  }

  getSyncMeta(key: string): Promise<SyncMetaEntry | undefined> {
    return this.syncMetaTable.get(key);
  }

  putSyncMeta(entry: SyncMetaEntry): Promise<void> {
    return this.syncMetaTable.put(entry).then(() => undefined);
  }

  getOutboxEntry(opId: string): Promise<OutboxEntry | undefined> {
    return this.outboxTable.get(opId);
  }

  listOutboxOrderedByCreatedAt(): Promise<OutboxEntry[]> {
    return this.outboxTable.orderBy('createdAt').toArray();
  }

  putOutboxEntry(entry: OutboxEntry): Promise<void> {
    return this.outboxTable.put(entry).then(() => undefined);
  }

  bulkDeleteOutbox(opIds: string[]): Promise<void> {
    return this.outboxTable.bulkDelete(opIds);
  }

  clearOutbox(): Promise<void> {
    return this.outboxTable.clear();
  }

  private get settingsTable(): Table<SettingsRow, number> {
    return this.resolveTable('settings', this.db.settings);
  }

  private get imageCacheTable(): Table<ImageCacheRecord, string> {
    return this.resolveTable('imageCache', this.db.imageCache);
  }

  private get syncMetaTable(): Table<SyncMetaEntry, string> {
    return this.resolveTable('syncMeta', this.db.syncMeta);
  }

  private get outboxTable(): Table<OutboxEntry, string> {
    return this.resolveTable('outbox', this.db.outbox);
  }

  private resolveTable<T, K>(scopeName: StorageScope, fallback: Table<T, K>): Table<T, K> {
    const active = this.activeTransaction;

    if (active && active.scope.has(scopeName)) {
      return active.transaction.table<T, K>(SCOPE_TABLE_NAMES[scopeName]);
    }

    return fallback;
  }

  private tablesForScope(scope: readonly StorageScope[]): Table<unknown, unknown>[] {
    return scope.map((store) => this.db.table(SCOPE_TABLE_NAMES[store]));
  }

  private isNestedTransactionCall(): boolean {
    const active = this.activeTransaction;
    if (!active || !isInsideStorageTransaction()) {
      return false;
    }

    const currentTransaction = Dexie.currentTransaction as Transaction | undefined;
    return !currentTransaction || currentTransaction === active.transaction;
  }
}
