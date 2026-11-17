import type {
  CatalogCard,
  CatalogRegion,
  CatalogSeries,
  CatalogSetPack,
  UserSettings,
} from '@pokepaper/shared';
import { SqliteConnection, SqliteStatement } from './sqlite-connection';
import {
  catalogKey,
  nestedScopeViolation,
  CatalogStats,
  ImageCacheRecord,
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
    const rows = await this.sql.query<PayloadRow>(
      'SELECT payload FROM image_cache_meta WHERE key = ?',
      [key]
    );
    return this.firstEntity(rows) as ImageCacheRecord | undefined;
  }

  async putImage(record: ImageCacheRecord): Promise<void> {
    await this.sql.run(
      `INSERT INTO image_cache_meta (key, file_path, payload) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET file_path = excluded.file_path, payload = excluded.payload`,
      this.imageCacheValues(record)
    );
  }

  async deleteImage(key: string): Promise<void> {
    await this.sql.run('DELETE FROM image_cache_meta WHERE key = ?', [key]);
  }

  async clearImageCache(): Promise<void> {
    await this.sql.run('DELETE FROM image_cache_meta', []);
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
    return this.runInTransaction(['catalogSets', 'catalogCards'], async () => {
      await this.sql.run('DELETE FROM catalog_cards WHERE set_key = ?', [key]);
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
    return this.runInTransaction(['catalogSets', 'catalogCards'], async () => {
      await this.sql.run('DELETE FROM catalog_cards WHERE set_key = ?', [key]);
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

  async catalogStats(): Promise<CatalogStats> {
    const rows = await this.sql.query<{ sets: number; cards: number }>(
      'SELECT (SELECT COUNT(*) FROM catalog_sets) AS sets, (SELECT COUNT(*) FROM catalog_cards) AS cards',
      []
    );
    return { sets: rows[0]?.sets ?? 0, cards: rows[0]?.cards ?? 0 };
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
    return [record.key, record.filePath ?? null, JSON.stringify(payload)];
  }

  private parseEntity(row: PayloadRow): unknown {
    return JSON.parse(row.payload);
  }

  private firstEntity(rows: PayloadRow[]): unknown {
    return rows.length > 0 ? this.parseEntity(rows[0]) : undefined;
  }

  private async executeBatched(statements: SqliteStatement[]): Promise<void> {
    for (let index = 0; index < statements.length; index += BULK_BATCH_SIZE) {
      const batch = statements.slice(index, index + BULK_BATCH_SIZE);
      await this.sql.executeSet(batch);
    }
  }
}
