import type { UserSettings } from '@pokepaper/shared';
import { SqliteConnection, SqliteStatement } from './sqlite-connection';
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
 */
export class SqliteStorageEngine implements StorageEngine {
  private transactionQueue: Promise<unknown> = Promise.resolve();

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
  runInTransaction<T>(_scope: readonly StorageScope[], action: () => Promise<T>): Promise<T> {
    if (isInsideStorageTransaction()) {
      return action();
    }

    const run = async (): Promise<T> =>
      runInsideStorageTransactionZone(async () => {
        await this.connection.beginTransaction();

        try {
          const result = await action();
          await this.connection.commitTransaction();
          return result;
        } catch (error: unknown) {
          await this.connection.rollbackTransaction().catch(() => undefined);
          throw error;
        }
      });

    const queued = this.transactionQueue.then(run, run);
    this.transactionQueue = queued.catch(() => undefined);
    return queued;
  }

  async getSettings(): Promise<UserSettings | undefined> {
    const rows = await this.connection.query<PayloadRow>(
      'SELECT payload FROM settings WHERE id = ?',
      [SETTINGS_ROW_ID]
    );
    return this.firstEntity(rows) as UserSettings | undefined;
  }

  async putSettings(settings: UserSettings): Promise<void> {
    await this.connection.run(
      `INSERT INTO settings (id, payload) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`,
      [SETTINGS_ROW_ID, JSON.stringify(settings)]
    );
  }

  async getImage(key: string): Promise<ImageCacheRecord | undefined> {
    const rows = await this.connection.query<PayloadRow>(
      'SELECT payload FROM image_cache_meta WHERE key = ?',
      [key]
    );
    return this.firstEntity(rows) as ImageCacheRecord | undefined;
  }

  async putImage(record: ImageCacheRecord): Promise<void> {
    await this.connection.run(
      `INSERT INTO image_cache_meta (key, file_path, payload) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET file_path = excluded.file_path, payload = excluded.payload`,
      this.imageCacheValues(record)
    );
  }

  async deleteImage(key: string): Promise<void> {
    await this.connection.run('DELETE FROM image_cache_meta WHERE key = ?', [key]);
  }

  async clearImageCache(): Promise<void> {
    await this.connection.run('DELETE FROM image_cache_meta', []);
  }

  async getSyncMeta(key: string): Promise<SyncMetaEntry | undefined> {
    const rows = await this.connection.query<PayloadRow>(
      'SELECT payload FROM sync_meta WHERE key = ?',
      [key]
    );
    return this.firstEntity(rows) as SyncMetaEntry | undefined;
  }

  async putSyncMeta(entry: SyncMetaEntry): Promise<void> {
    await this.connection.run(
      `INSERT INTO sync_meta (key, payload) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET payload = excluded.payload`,
      [entry.key, JSON.stringify(entry)]
    );
  }

  async getOutboxEntry(opId: string): Promise<OutboxEntry | undefined> {
    const rows = await this.connection.query<PayloadRow>(
      'SELECT payload FROM outbox WHERE op_id = ?',
      [opId]
    );
    return this.firstEntity(rows) as OutboxEntry | undefined;
  }

  async listOutboxOrderedByCreatedAt(): Promise<OutboxEntry[]> {
    const rows = await this.connection.query<PayloadRow>(
      'SELECT payload FROM outbox ORDER BY created_at',
      []
    );
    return rows.map((row) => this.parseEntity(row) as OutboxEntry);
  }

  async putOutboxEntry(entry: OutboxEntry): Promise<void> {
    await this.connection.run(
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
    await this.connection.run('DELETE FROM outbox', []);
  }

  /** Excludes `blob`: native never stores image bytes in SQLite, only the
   * filesystem path the bytes were written under. */
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
      await this.connection.executeSet(batch);
    }
  }
}
