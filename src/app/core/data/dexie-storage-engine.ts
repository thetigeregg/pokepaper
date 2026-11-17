import { Injectable, inject } from '@angular/core';
import Dexie, { Table, Transaction } from 'dexie';
import type {
  CatalogCard,
  CatalogRegion,
  CatalogSeries,
  CatalogSetPack,
  UserSettings,
} from '@pokepaper/shared';
import { AppDb, CatalogCardRow, CatalogSeriesRow, SettingsRow } from './app-db';
import {
  catalogKey,
  nestedScopeViolation,
  CatalogStats,
  DownloadedSet,
  ImageCacheRecord,
  ImageCacheUsage,
  ImagePin,
  PinnedSetSummary,
  StoredImageRef,
  OutboxEntry,
  StorageEngine,
  StorageScope,
  StoredCatalogSet,
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
  catalogSeries: 'catalogSeries',
  catalogSets: 'catalogSets',
  catalogCards: 'catalogCards',
  imagePins: 'imagePins',
  downloadedSets: 'downloadedSets',
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
    const active = this.activeTransaction;
    if (active && this.isNestedTransactionCall()) {
      const violation = nestedScopeViolation(active.scope, scope);
      return violation ? Promise.reject(violation) : action();
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

  async touchImage(key: string, at: string): Promise<void> {
    await this.imageCacheTable.update(key, { lastAccessedAt: at });
  }

  deleteImage(key: string): Promise<void> {
    return this.imageCacheTable.delete(key);
  }

  deleteImages(keys: readonly string[]): Promise<void> {
    return this.imageCacheTable.bulkDelete([...keys]);
  }

  evictImages(keys: readonly string[]): Promise<StoredImageRef[]> {
    return this.runInTransaction(['imageCache', 'imagePins'], async () => {
      const pinned = await this.pinnedImageKeys();
      const records = (await this.imageCacheTable.bulkGet(keys.filter((key) => !pinned.has(key))))
        .filter((record) => record !== undefined)
        .map(toImageRef);
      await this.imageCacheTable.bulkDelete(records.map((record) => record.key));
      return records;
    });
  }

  clearImageCache(): Promise<void> {
    return this.runInTransaction(['imageCache', 'imagePins', 'downloadedSets'], async () => {
      await this.imageCacheTable.clear();
      await this.imagePinsTable.clear();
      await this.downloadedSetsTable.clear();
    });
  }

  imageCacheUsage(): Promise<ImageCacheUsage> {
    return this.runInTransaction(['imageCache', 'imagePins'], async () => {
      const pinned = await this.pinnedImageKeys();
      const usage: ImageCacheUsage = { pinnedBytes: 0, unpinnedBytes: 0 };
      await this.imageCacheTable.each((record) => {
        if (pinned.has(record.key)) {
          usage.pinnedBytes += record.size;
        } else {
          usage.unpinnedBytes += record.size;
        }
      });
      return usage;
    });
  }

  listEvictableImages(limit: number): Promise<StoredImageRef[]> {
    return this.runInTransaction(['imageCache', 'imagePins'], async () => {
      const pinned = await this.pinnedImageKeys();
      const records = await this.imageCacheTable
        .orderBy('lastAccessedAt')
        .filter((record) => !pinned.has(record.key))
        .limit(limit)
        .toArray();
      return records.map(toImageRef);
    });
  }

  deleteUnpinnedImages(): Promise<StoredImageRef[]> {
    return this.runInTransaction(['imageCache', 'imagePins'], async () => {
      const pinned = await this.pinnedImageKeys();
      const removed = (
        await this.imageCacheTable.filter((record) => !pinned.has(record.key)).toArray()
      ).map(toImageRef);
      await this.imageCacheTable.bulkDelete(removed.map((record) => record.key));
      return removed;
    });
  }

  async pinImages(setKey: string, imageKeys: readonly string[]): Promise<void> {
    await this.imagePinsTable.bulkPut(imageKeys.map((imageKey) => ({ setKey, imageKey })));
  }

  async unpinSet(setKey: string): Promise<void> {
    await this.imagePinsTable.where('setKey').equals(setKey).delete();
  }

  listPinnedSets(): Promise<PinnedSetSummary[]> {
    return this.runInTransaction(['imageCache', 'imagePins'], async () => {
      const bySet = new Map<string, string[]>();
      for (const pin of await this.imagePinsTable.toArray()) {
        const keys = bySet.get(pin.setKey);
        if (keys) {
          keys.push(pin.imageKey);
        } else {
          bySet.set(pin.setKey, [pin.imageKey]);
        }
      }
      const summaries: PinnedSetSummary[] = [];
      for (const [setKey, keys] of bySet) {
        const stored = (await this.imageCacheTable.bulkGet(keys)).filter(
          (record) => record !== undefined
        );
        summaries.push({
          setKey,
          images: stored.length,
          bytes: stored.reduce((total, record) => total + record.size, 0),
        });
      }
      return summaries.sort((a, b) => a.setKey.localeCompare(b.setKey));
    });
  }

  async putDownloadedSet(record: DownloadedSet): Promise<void> {
    await this.downloadedSetsTable.put(record);
  }

  listDownloadedSets(): Promise<DownloadedSet[]> {
    return this.downloadedSetsTable.toArray();
  }

  deleteDownloadedSet(setKey: string): Promise<void> {
    return this.downloadedSetsTable.delete(setKey);
  }

  private async pinnedImageKeys(): Promise<Set<string>> {
    return new Set((await this.imagePinsTable.orderBy('imageKey').uniqueKeys()) as string[]);
  }

  getSyncMeta(key: string): Promise<SyncMetaEntry | undefined> {
    return this.syncMetaTable.get(key);
  }

  putSyncMeta(entry: SyncMetaEntry): Promise<void> {
    return this.syncMetaTable.put(entry).then(() => undefined);
  }

  replaceCatalogSeries(series: readonly CatalogSeries[]): Promise<void> {
    return this.runInTransaction(['catalogSeries'], async () => {
      await this.catalogSeriesTable.clear();
      await this.catalogSeriesTable.bulkPut(
        series.map((entry) => ({ key: catalogKey(entry.region, entry.id), series: entry }))
      );
    });
  }

  async listCatalogSeries(): Promise<CatalogSeries[]> {
    return (await this.catalogSeriesTable.toArray()).map((row) => row.series);
  }

  replaceCatalogSet(pack: CatalogSetPack): Promise<void> {
    const key = catalogKey(pack.set.region, pack.set.id);
    return this.runInTransaction(['catalogSets', 'catalogCards'], async () => {
      await this.catalogCardsTable.where('setKey').equals(key).delete();
      await this.catalogCardsTable.bulkPut(
        pack.cards.map((card) => ({
          key: catalogKey(card.region, card.id),
          setKey: key,
          sortIndex: card.sortIndex,
          card,
        }))
      );
      await this.catalogSetsTable.put({
        key,
        region: pack.set.region,
        hash: pack.hash,
        set: pack.set,
      });
    });
  }

  deleteCatalogSet(region: CatalogRegion, setId: string): Promise<void> {
    const key = catalogKey(region, setId);
    return this.runInTransaction(['catalogSets', 'catalogCards'], async () => {
      await this.catalogCardsTable.where('setKey').equals(key).delete();
      await this.catalogSetsTable.delete(key);
    });
  }

  listCatalogSets(region?: CatalogRegion): Promise<StoredCatalogSet[]> {
    return region
      ? this.catalogSetsTable.where('region').equals(region).toArray()
      : this.catalogSetsTable.toArray();
  }

  async listCatalogCards(region: CatalogRegion, setId: string): Promise<CatalogCard[]> {
    const key = catalogKey(region, setId);
    // The compound index returns the set's rows already in display order.
    const rows = await this.catalogCardsTable
      .where('[setKey+sortIndex]')
      .between([key, Dexie.minKey], [key, Dexie.maxKey])
      .toArray();
    return rows.map((row) => row.card);
  }

  async getCatalogCard(region: CatalogRegion, cardId: string): Promise<CatalogCard | undefined> {
    return (await this.catalogCardsTable.get(catalogKey(region, cardId)))?.card;
  }

  async catalogStats(): Promise<CatalogStats> {
    const [sets, cards] = await Promise.all([
      this.catalogSetsTable.count(),
      this.catalogCardsTable.count(),
    ]);
    return { sets, cards };
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

  private get catalogSeriesTable(): Table<CatalogSeriesRow, string> {
    return this.resolveTable('catalogSeries', this.db.catalogSeries);
  }

  private get catalogSetsTable(): Table<StoredCatalogSet, string> {
    return this.resolveTable('catalogSets', this.db.catalogSets);
  }

  private get catalogCardsTable(): Table<CatalogCardRow, string> {
    return this.resolveTable('catalogCards', this.db.catalogCards);
  }

  private get imagePinsTable(): Table<ImagePin, [string, string]> {
    return this.resolveTable('imagePins', this.db.imagePins);
  }

  private get downloadedSetsTable(): Table<DownloadedSet, string> {
    return this.resolveTable('downloadedSets', this.db.downloadedSets);
  }

  /**
   * Routes a call through the active transaction only when the caller is
   * running *inside* that transaction's action. Callers outside it (e.g.
   * SyncService while a repository write is in flight) use the global table,
   * so IndexedDB gives them their own transaction: they never see
   * uncommitted rows or commit/abort with someone else's transaction.
   */
  private resolveTable<T, K>(scopeName: StorageScope, fallback: Table<T, K>): Table<T, K> {
    const active = this.activeTransaction;

    if (active && active.scope.has(scopeName) && isInsideStorageTransaction()) {
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

function toImageRef(record: ImageCacheRecord): StoredImageRef {
  return { key: record.key, filePath: record.filePath ?? null, size: record.size };
}
