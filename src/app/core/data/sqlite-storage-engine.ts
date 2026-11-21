import type {
  CatalogCard,
  CatalogCardPrices,
  CatalogPricePack,
  CatalogRegion,
  CatalogSeries,
  CatalogSetPack,
  CollectionEntry,
  Deck,
  UserSettings,
} from '@pokepaper/shared';
import { collectionEntryId } from '@pokepaper/shared';
import { catalogSearchRow } from './catalog-search-row';
import { SqliteConnection, SqliteStatement } from './sqlite-connection';
import {
  catalogKey,
  nestedScopeViolation,
  CatalogSearchRow,
  CatalogStats,
  DownloadedSet,
  ImageCacheRecord,
  ImageCacheUsage,
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

const BULK_BATCH_SIZE = 500;
/** SQL condition: image `i` is pinned by at least one downloaded set. */
const PINNED = 'EXISTS (SELECT 1 FROM image_pins p WHERE p.image_key = i.key)';
const SETTINGS_ROW_ID = 1;

interface PayloadRow {
  payload: string;
}

/**
 * Native SQLite storage engine backed by @capacitor-community/sqlite (iOS).
 * Ported from go-gather.
 *
 * Each table keeps the columns needed for indexing plus the full entity as a
 * JSON payload column, so business logic sees identical entities on both
 * platforms. Every write is a keyed `INSERT ... ON CONFLICT DO UPDATE` upsert.
 *
 * There is one connection, so a BEGIN applies to every statement sent on it
 * until COMMIT/ROLLBACK. To keep callers outside a transaction from joining
 * (and being rolled back with) someone else's transaction, every public
 * operation goes through `serialized()`: calls made inside a running
 * transaction action run immediately; all other calls wait their turn in the
 * same queue as transactions.
 */
export class SqliteStorageEngine implements StorageEngine {
  private transactionQueue: Promise<unknown> = Promise.resolve();
  private activeScope: ReadonlySet<StorageScope> | null = null;

  constructor(private readonly connection: SqliteConnection) {}

  initialize(): Promise<void> {
    // The connection factory opens and migrates the database before the
    // engine is constructed.
    return Promise.resolve();
  }

  /**
   * Independent transactions are serialized on the single connection so each
   * runInTransaction gets its own begin/commit/rollback boundary. Nested calls
   * join the active transaction instead of starting a new one.
   */
  runInTransaction<T>(scope: readonly StorageScope[], action: () => Promise<T>): Promise<T> {
    if (isInsideStorageTransaction()) {
      const violation = this.activeScope ? nestedScopeViolation(this.activeScope, scope) : null;
      return violation ? Promise.reject(violation) : action();
    }

    return this.enqueue(() =>
      runInsideStorageTransactionZone(async () => {
        this.activeScope = new Set(scope);
        await this.connection.beginTransaction();

        try {
          const result = await action();
          await this.connection.commitTransaction();
          return result;
        } catch (error: unknown) {
          await this.connection.rollbackTransaction().catch(() => undefined);
          throw error;
        } finally {
          this.activeScope = null;
        }
      })
    );
  }

  async getSettings(): Promise<UserSettings | undefined> {
    const rows = await this.sql.query<PayloadRow>('SELECT payload FROM settings WHERE id = ?', [
      SETTINGS_ROW_ID,
    ]);
    return this.firstEntity(rows) as UserSettings | undefined;
  }

  async putSettings(settings: UserSettings): Promise<void> {
    await this.sql.run(
      `INSERT INTO settings (id, payload) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`,
      [SETTINGS_ROW_ID, JSON.stringify(settings)]
    );
  }

  async getImage(key: string): Promise<ImageCacheRecord | undefined> {
    const rows = await this.sql.query<PayloadRow & { last_accessed_at: string }>(
      'SELECT payload, last_accessed_at FROM image_cache_meta WHERE key = ?',
      [key]
    );
    const row = rows.at(0);
    if (!row) {
      return undefined;
    }
    // The column is authoritative: touchImage updates only it.
    const record = this.parseEntity(row) as ImageCacheRecord;
    return { ...record, lastAccessedAt: row.last_accessed_at || record.lastAccessedAt };
  }

  async putImage(record: ImageCacheRecord): Promise<void> {
    await this.sql.run(
      `INSERT INTO image_cache_meta (key, file_path, size, last_accessed_at, payload)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         file_path = excluded.file_path,
         size = excluded.size,
         last_accessed_at = excluded.last_accessed_at,
         payload = excluded.payload`,
      this.imageCacheValues(record)
    );
  }

  async touchImage(key: string, at: string): Promise<void> {
    await this.sql.run('UPDATE image_cache_meta SET last_accessed_at = ? WHERE key = ?', [at, key]);
  }

  async deleteImage(key: string): Promise<void> {
    await this.sql.run('DELETE FROM image_cache_meta WHERE key = ?', [key]);
  }

  async deleteImages(keys: readonly string[]): Promise<void> {
    await this.executeBatched(
      keys.map((key) => ({
        statement: 'DELETE FROM image_cache_meta WHERE key = ?',
        values: [key],
      }))
    );
  }

  evictImages(keys: readonly string[]): Promise<StoredImageRef[]> {
    return this.runInTransaction(['imageCache', 'imagePins'], async () => {
      const removed: StoredImageRef[] = [];
      for (const key of keys) {
        const rows = await this.sql.query<{ key: string; file_path: string | null; size: number }>(
          `SELECT key, file_path, size FROM image_cache_meta i WHERE key = ? AND NOT ${PINNED}`,
          [key]
        );
        const row = rows.at(0);
        if (row) {
          await this.sql.run('DELETE FROM image_cache_meta WHERE key = ?', [key]);
          removed.push({ key: row.key, filePath: row.file_path, size: row.size });
        }
      }
      return removed;
    });
  }

  clearImageCache(): Promise<void> {
    return this.runInTransaction(['imageCache', 'imagePins', 'downloadedSets'], async () => {
      await this.sql.run('DELETE FROM image_cache_meta', []);
      await this.sql.run('DELETE FROM image_pins', []);
      await this.sql.run('DELETE FROM downloaded_sets', []);
    });
  }

  async imageCacheUsage(): Promise<ImageCacheUsage> {
    const rows = await this.sql.query<{ pinned: number | null; unpinned: number | null }>(
      `SELECT
         SUM(CASE WHEN ${PINNED} THEN size ELSE 0 END) AS pinned,
         SUM(CASE WHEN ${PINNED} THEN 0 ELSE size END) AS unpinned
       FROM image_cache_meta i`,
      []
    );
    return { pinnedBytes: rows[0]?.pinned ?? 0, unpinnedBytes: rows[0]?.unpinned ?? 0 };
  }

  async listEvictableImages(limit: number): Promise<StoredImageRef[]> {
    return (
      await this.sql.query<{ key: string; file_path: string | null; size: number }>(
        `SELECT key, file_path, size FROM image_cache_meta i
         WHERE NOT ${PINNED} ORDER BY last_accessed_at LIMIT ?`,
        [limit]
      )
    ).map((row) => ({ key: row.key, filePath: row.file_path, size: row.size }));
  }

  deleteUnpinnedImages(): Promise<StoredImageRef[]> {
    return this.runInTransaction(['imageCache', 'imagePins'], async () => {
      const removed = (
        await this.sql.query<{ key: string; file_path: string | null; size: number }>(
          `SELECT key, file_path, size FROM image_cache_meta i WHERE NOT ${PINNED}`,
          []
        )
      ).map((row) => ({ key: row.key, filePath: row.file_path, size: row.size }));
      await this.sql.run(`DELETE FROM image_cache_meta AS i WHERE NOT ${PINNED}`, []);
      return removed;
    });
  }

  async pinImages(setKey: string, imageKeys: readonly string[]): Promise<void> {
    await this.executeBatched(
      imageKeys.map((imageKey) => ({
        statement: 'INSERT OR IGNORE INTO image_pins (set_key, image_key) VALUES (?, ?)',
        values: [setKey, imageKey],
      }))
    );
  }

  async unpinSet(setKey: string): Promise<void> {
    await this.sql.run('DELETE FROM image_pins WHERE set_key = ?', [setKey]);
  }

  async putDownloadedSet(record: DownloadedSet): Promise<void> {
    await this.sql.run(
      `INSERT INTO downloaded_sets (set_key, payload) VALUES (?, ?)
       ON CONFLICT(set_key) DO UPDATE SET payload = excluded.payload`,
      [record.setKey, JSON.stringify(record)]
    );
  }

  async listDownloadedSets(): Promise<DownloadedSet[]> {
    const rows = await this.sql.query<PayloadRow>('SELECT payload FROM downloaded_sets', []);
    return rows.map((row) => this.parseEntity(row) as DownloadedSet);
  }

  async deleteDownloadedSet(setKey: string): Promise<void> {
    await this.sql.run('DELETE FROM downloaded_sets WHERE set_key = ?', [setKey]);
  }

  async listPinnedSets(): Promise<PinnedSetSummary[]> {
    return (
      await this.sql.query<{ set_key: string; images: number; bytes: number | null }>(
        `SELECT p.set_key, COUNT(i.key) AS images, SUM(i.size) AS bytes
         FROM image_pins p LEFT JOIN image_cache_meta i ON i.key = p.image_key
         GROUP BY p.set_key ORDER BY p.set_key`,
        []
      )
    ).map((row) => ({ setKey: row.set_key, images: row.images, bytes: row.bytes ?? 0 }));
  }

  async getSyncMeta(key: string): Promise<SyncMetaEntry | undefined> {
    const rows = await this.sql.query<PayloadRow>('SELECT payload FROM sync_meta WHERE key = ?', [
      key,
    ]);
    return this.firstEntity(rows) as SyncMetaEntry | undefined;
  }

  async putSyncMeta(entry: SyncMetaEntry): Promise<void> {
    await this.sql.run(
      `INSERT INTO sync_meta (key, payload) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET payload = excluded.payload`,
      [entry.key, JSON.stringify(entry)]
    );
  }

  replaceCatalogSeries(series: readonly CatalogSeries[]): Promise<void> {
    return this.runInTransaction(['catalogSeries'], async () => {
      await this.sql.run('DELETE FROM catalog_series', []);
      await this.executeBatched(
        series.map((entry) => ({
          statement: `INSERT INTO catalog_series (key, payload) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET payload = excluded.payload`,
          values: [catalogKey(entry.region, entry.id), JSON.stringify(entry)],
        }))
      );
    });
  }

  async listCatalogSeries(): Promise<CatalogSeries[]> {
    const rows = await this.sql.query<PayloadRow>('SELECT payload FROM catalog_series', []);
    return rows.map((row) => this.parseEntity(row) as CatalogSeries);
  }

  replaceCatalogSet(pack: CatalogSetPack): Promise<void> {
    const key = catalogKey(pack.set.region, pack.set.id);
    const stored: StoredCatalogSet = {
      key,
      region: pack.set.region,
      hash: pack.hash,
      set: pack.set,
    };
    return this.runInTransaction(['catalogSets', 'catalogCards', 'catalogCardSearch'], async () => {
      await this.sql.run('DELETE FROM catalog_cards WHERE set_key = ?', [key]);
      await this.replaceSearchRows(
        key,
        pack.cards.map((card) => catalogSearchRow(card, key))
      );
      await this.executeBatched(
        pack.cards.map((card) => ({
          statement: `INSERT INTO catalog_cards (key, set_key, sort_index, payload) VALUES (?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
              set_key = excluded.set_key,
              sort_index = excluded.sort_index,
              payload = excluded.payload`,
          values: [catalogKey(card.region, card.id), key, card.sortIndex, JSON.stringify(card)],
        }))
      );
      await this.sql.run(
        `INSERT INTO catalog_sets (key, region, payload) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET region = excluded.region, payload = excluded.payload`,
        [key, stored.region, JSON.stringify(stored)]
      );
    });
  }

  deleteCatalogSet(region: CatalogRegion, setId: string): Promise<void> {
    const key = catalogKey(region, setId);
    return this.runInTransaction(['catalogSets', 'catalogCards', 'catalogCardSearch'], async () => {
      await this.sql.run('DELETE FROM catalog_cards WHERE set_key = ?', [key]);
      await this.sql.run('DELETE FROM catalog_card_search WHERE set_key = ?', [key]);
      await this.sql.run('DELETE FROM catalog_sets WHERE key = ?', [key]);
    });
  }

  async listCatalogSets(region?: CatalogRegion): Promise<StoredCatalogSet[]> {
    const rows = region
      ? await this.sql.query<PayloadRow>('SELECT payload FROM catalog_sets WHERE region = ?', [
          region,
        ])
      : await this.sql.query<PayloadRow>('SELECT payload FROM catalog_sets', []);
    return rows.map((row) => this.parseEntity(row) as StoredCatalogSet);
  }

  async getCatalogSet(region: CatalogRegion, setId: string): Promise<StoredCatalogSet | undefined> {
    const rows = await this.sql.query<PayloadRow>(
      'SELECT payload FROM catalog_sets WHERE key = ?',
      [catalogKey(region, setId)]
    );
    return this.firstEntity(rows) as StoredCatalogSet | undefined;
  }

  async listCatalogCards(region: CatalogRegion, setId: string): Promise<CatalogCard[]> {
    const rows = await this.sql.query<PayloadRow>(
      'SELECT payload FROM catalog_cards WHERE set_key = ? ORDER BY sort_index',
      [catalogKey(region, setId)]
    );
    return rows.map((row) => this.parseEntity(row) as CatalogCard);
  }

  async getCatalogCard(region: CatalogRegion, cardId: string): Promise<CatalogCard | undefined> {
    const rows = await this.sql.query<PayloadRow>(
      'SELECT payload FROM catalog_cards WHERE key = ?',
      [catalogKey(region, cardId)]
    );
    return this.firstEntity(rows) as CatalogCard | undefined;
  }

  async getCatalogCardsByKey(keys: readonly string[]): Promise<CatalogCard[]> {
    const byKey = new Map<string, CatalogCard>();
    for (let index = 0; index < keys.length; index += BULK_BATCH_SIZE) {
      const batch = keys.slice(index, index + BULK_BATCH_SIZE);
      const rows = await this.sql.query<PayloadRow & { key: string }>(
        `SELECT key, payload FROM catalog_cards WHERE key IN (${batch.map(() => '?').join(', ')})`,
        batch
      );
      for (const row of rows) {
        byKey.set(row.key, this.parseEntity(row) as CatalogCard);
      }
    }
    return keys.flatMap((key) => {
      const card = byKey.get(key);
      return card ? [card] : [];
    });
  }

  async catalogStats(): Promise<CatalogStats> {
    const rows = await this.sql.query<{ sets: number; cards: number }>(
      'SELECT (SELECT COUNT(*) FROM catalog_sets) AS sets, (SELECT COUNT(*) FROM catalog_cards) AS cards',
      []
    );
    return { sets: rows[0]?.sets ?? 0, cards: rows[0]?.cards ?? 0 };
  }

  async listCatalogSearchRows(region: CatalogRegion): Promise<CatalogSearchRow[]> {
    const rows = await this.sql.query<PayloadRow>(
      'SELECT payload FROM catalog_card_search WHERE region = ?',
      [region]
    );
    return rows.map((row) => this.parseEntity(row) as CatalogSearchRow);
  }

  reindexCatalogSet(region: CatalogRegion, setId: string): Promise<void> {
    const key = catalogKey(region, setId);
    return this.runInTransaction(['catalogCards', 'catalogCardSearch'], async () => {
      const rows = await this.sql.query<PayloadRow>(
        'SELECT payload FROM catalog_cards WHERE set_key = ?',
        [key]
      );
      await this.replaceSearchRows(
        key,
        rows.map((row) => catalogSearchRow(this.parseEntity(row) as CatalogCard, key))
      );
    });
  }

  replaceCatalogPrices(pack: CatalogPricePack): Promise<void> {
    return this.runInTransaction(['catalogPrices'], async () => {
      await this.sql.run('DELETE FROM catalog_prices WHERE region = ?', [pack.region]);
      await this.executeBatched(
        Object.entries(pack.prices).map(([cardId, prices]) => ({
          statement: `INSERT INTO catalog_prices (key, region, payload) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET region = excluded.region, payload = excluded.payload`,
          values: [catalogKey(pack.region, cardId), pack.region, JSON.stringify(prices)],
        }))
      );
    });
  }

  async getCatalogCardPrices(
    region: CatalogRegion,
    cardId: string
  ): Promise<CatalogCardPrices | undefined> {
    const rows = await this.sql.query<PayloadRow>(
      'SELECT payload FROM catalog_prices WHERE key = ?',
      [catalogKey(region, cardId)]
    );
    return this.firstEntity(rows) as CatalogCardPrices | undefined;
  }

  async getCatalogPricesByKey(keys: readonly string[]): Promise<Map<string, CatalogCardPrices>> {
    const prices = new Map<string, CatalogCardPrices>();
    for (let index = 0; index < keys.length; index += BULK_BATCH_SIZE) {
      const batch = keys.slice(index, index + BULK_BATCH_SIZE);
      const rows = await this.sql.query<PayloadRow & { key: string }>(
        `SELECT key, payload FROM catalog_prices WHERE key IN (${batch.map(() => '?').join(', ')})`,
        batch
      );
      for (const row of rows) {
        prices.set(row.key, this.parseEntity(row) as CatalogCardPrices);
      }
    }
    return prices;
  }

  async putCollectionEntry(entry: CollectionEntry): Promise<void> {
    await this.sql.run(
      `INSERT INTO collection_entries (key, payload) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET payload = excluded.payload`,
      [collectionEntryId(entry), JSON.stringify(entry)]
    );
  }

  async deleteCollectionEntry(key: string): Promise<void> {
    await this.sql.run('DELETE FROM collection_entries WHERE key = ?', [key]);
  }

  async listCollectionEntries(): Promise<CollectionEntry[]> {
    const rows = await this.sql.query<PayloadRow>('SELECT payload FROM collection_entries', []);
    return rows.map((row) => this.parseEntity(row) as CollectionEntry);
  }

  async putDeck(deck: Deck): Promise<void> {
    await this.sql.run(
      `INSERT INTO decks (key, payload) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET payload = excluded.payload`,
      [deck.id, JSON.stringify(deck)]
    );
  }

  async deleteDeck(id: string): Promise<void> {
    await this.sql.run('DELETE FROM decks WHERE key = ?', [id]);
  }

  async listDecks(): Promise<Deck[]> {
    const rows = await this.sql.query<PayloadRow>('SELECT payload FROM decks', []);
    return rows.map((row) => this.parseEntity(row) as Deck);
  }

  async getOutboxEntry(opId: string): Promise<OutboxEntry | undefined> {
    const rows = await this.sql.query<PayloadRow>('SELECT payload FROM outbox WHERE op_id = ?', [
      opId,
    ]);
    return this.firstEntity(rows) as OutboxEntry | undefined;
  }

  async listOutboxOrderedByCreatedAt(): Promise<OutboxEntry[]> {
    const rows = await this.sql.query<PayloadRow>(
      'SELECT payload FROM outbox ORDER BY created_at',
      []
    );
    return rows.map((row) => this.parseEntity(row) as OutboxEntry);
  }

  async putOutboxEntry(entry: OutboxEntry): Promise<void> {
    await this.sql.run(
      `INSERT INTO outbox (op_id, entity_type, created_at, payload) VALUES (?, ?, ?, ?)
       ON CONFLICT(op_id) DO UPDATE SET
         entity_type = excluded.entity_type,
         created_at = excluded.created_at,
         payload = excluded.payload`,
      [entry.opId, entry.entityType, entry.createdAt, JSON.stringify(entry)]
    );
  }

  async bulkDeleteOutbox(opIds: string[]): Promise<void> {
    await this.executeBatched(
      opIds.map((opId) => ({ statement: 'DELETE FROM outbox WHERE op_id = ?', values: [opId] }))
    );
  }

  async clearOutbox(): Promise<void> {
    await this.sql.run('DELETE FROM outbox', []);
  }

  /** Excludes `blob`: native never stores image bytes in SQLite, only the
   * filesystem path the bytes were written under. */
  /** Statement surface used by every data method; see the class comment. */
  private readonly sql = {
    run: (statement: string, values: unknown[]) =>
      this.serialized(() => this.connection.run(statement, values)),
    query: <R>(statement: string, values: unknown[]) =>
      this.serialized(() => this.connection.query<R>(statement, values)),
    executeSet: (statements: SqliteStatement[]) =>
      this.serialized(() => this.connection.executeSet(statements)),
  };

  /** Runs now when inside a transaction action; otherwise queues behind open transactions. */
  private serialized<R>(operation: () => Promise<R>): Promise<R> {
    return isInsideStorageTransaction() ? operation() : this.enqueue(operation);
  }

  private enqueue<R>(operation: () => Promise<R>): Promise<R> {
    const queued = this.transactionQueue.then(operation, operation);
    this.transactionQueue = queued.catch(() => undefined);
    return queued;
  }

  private imageCacheValues(record: ImageCacheRecord): unknown[] {
    const { blob: _blob, ...payload } = record;
    return [
      record.key,
      record.filePath ?? null,
      record.size,
      record.lastAccessedAt,
      JSON.stringify(payload),
    ];
  }

  private parseEntity(row: PayloadRow): unknown {
    return JSON.parse(row.payload);
  }

  private firstEntity(rows: PayloadRow[]): unknown {
    return rows.length > 0 ? this.parseEntity(rows[0]) : undefined;
  }

  /** Makes `rows` the search rows stored under `setKey` (call inside a transaction). */
  private async replaceSearchRows(setKey: string, rows: CatalogSearchRow[]): Promise<void> {
    await this.sql.run('DELETE FROM catalog_card_search WHERE set_key = ?', [setKey]);
    await this.executeBatched(
      rows.map((row) => ({
        statement: `INSERT INTO catalog_card_search (key, region, set_key, payload) VALUES (?, ?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            region = excluded.region,
            set_key = excluded.set_key,
            payload = excluded.payload`,
        values: [row.key, row.region, row.setKey, JSON.stringify(row)],
      }))
    );
  }

  private async executeBatched(statements: SqliteStatement[]): Promise<void> {
    for (let index = 0; index < statements.length; index += BULK_BATCH_SIZE) {
      const batch = statements.slice(index, index + BULK_BATCH_SIZE);
      await this.sql.executeSet(batch);
    }
  }
}
