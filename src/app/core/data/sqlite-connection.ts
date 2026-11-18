import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';

export interface SqliteStatement {
  statement: string;
  values: unknown[];
}

export interface SqliteRunResult {
  changes: number;
  lastId: number | undefined;
}

/**
 * Thin SQL execution surface the SqliteStorageEngine talks to. Production uses
 * the @capacitor-community/sqlite plugin; tests provide an in-process SQLite
 * implementation with the same semantics.
 */
export interface SqliteConnection {
  run(statement: string, values: unknown[]): Promise<SqliteRunResult>;
  query<T = Record<string, unknown>>(statement: string, values: unknown[]): Promise<T[]>;
  executeSet(statements: SqliteStatement[]): Promise<void>;
  beginTransaction(): Promise<void>;
  commitTransaction(): Promise<void>;
  rollbackTransaction(): Promise<void>;
  close(): Promise<void>;
}

export const SQLITE_DB_NAME = 'pokepaper';
export const SQLITE_SCHEMA_VERSION = 5;

/**
 * Native schema migrations, applied by the Capacitor plugin on open. Append a
 * new `toVersion` entry (and bump SQLITE_SCHEMA_VERSION) for schema changes;
 * never edit a shipped entry. Keep in step with the Dexie schema in app-db.ts.
 *
 * Each table keeps the columns needed for indexing plus the full entity as a
 * JSON `payload` column, so business logic sees identical entities on web
 * and native.
 */
export const SQLITE_UPGRADE_STATEMENTS: { toVersion: number; statements: string[] }[] = [
  {
    toVersion: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload TEXT NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS image_cache_meta (
        key TEXT PRIMARY KEY,
        file_path TEXT,
        payload TEXT NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS outbox (
        op_id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );`,
      `CREATE INDEX IF NOT EXISTS idx_outbox_created_at ON outbox (created_at);`,
    ],
  },
  {
    // Card catalog (docs/catalog.md). Matches Dexie version 2.
    toVersion: 2,
    statements: [
      `CREATE TABLE IF NOT EXISTS catalog_series (
        key TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS catalog_sets (
        key TEXT PRIMARY KEY,
        region TEXT NOT NULL,
        payload TEXT NOT NULL
      );`,
      `CREATE INDEX IF NOT EXISTS idx_catalog_sets_region ON catalog_sets (region);`,
      `CREATE TABLE IF NOT EXISTS catalog_cards (
        key TEXT PRIMARY KEY,
        set_key TEXT NOT NULL,
        sort_index INTEGER NOT NULL,
        payload TEXT NOT NULL
      );`,
      `CREATE INDEX IF NOT EXISTS idx_catalog_cards_set ON catalog_cards (set_key, sort_index);`,
    ],
  },
  {
    // Image cache size limit and offline sets. Matches Dexie version 3.
    toVersion: 3,
    statements: [
      `ALTER TABLE image_cache_meta ADD COLUMN size INTEGER NOT NULL DEFAULT 0;`,
      `ALTER TABLE image_cache_meta ADD COLUMN last_accessed_at TEXT NOT NULL DEFAULT '';`,
      `CREATE INDEX IF NOT EXISTS idx_image_cache_accessed ON image_cache_meta (last_accessed_at);`,
      `CREATE TABLE IF NOT EXISTS image_pins (
        set_key TEXT NOT NULL,
        image_key TEXT NOT NULL,
        PRIMARY KEY (set_key, image_key)
      );`,
      `CREATE INDEX IF NOT EXISTS idx_image_pins_image ON image_pins (image_key);`,
      `CREATE TABLE IF NOT EXISTS downloaded_sets (
        set_key TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );`,
    ],
  },
  {
    // Card search rows. Matches Dexie version 4. Existing catalogs get their
    // rows from CatalogSearchService's rebuild.
    toVersion: 4,
    statements: [
      `CREATE TABLE IF NOT EXISTS catalog_card_search (
        key TEXT PRIMARY KEY,
        region TEXT NOT NULL,
        set_key TEXT NOT NULL,
        payload TEXT NOT NULL
      );`,
      `CREATE INDEX IF NOT EXISTS idx_catalog_card_search_region ON catalog_card_search (region);`,
      `CREATE INDEX IF NOT EXISTS idx_catalog_card_search_set ON catalog_card_search (set_key);`,
    ],
  },
  {
    // Collection entries (docs/collection.md). Matches Dexie version 5.
    toVersion: 5,
    statements: [
      `CREATE TABLE IF NOT EXISTS collection_entries (
        key TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );`,
    ],
  },
];

class CapacitorSqliteConnection implements SqliteConnection {
  constructor(
    private readonly sqlite: SQLiteConnection,
    private readonly db: SQLiteDBConnection,
    private readonly dbName: string
  ) {}

  async run(statement: string, values: unknown[]): Promise<SqliteRunResult> {
    const result = await this.db.run(statement, values, false);
    return {
      changes: result.changes?.changes ?? 0,
      lastId: result.changes?.lastId,
    };
  }

  async query<T = Record<string, unknown>>(statement: string, values: unknown[]): Promise<T[]> {
    const result = await this.db.query(statement, values);
    return (result.values ?? []) as T[];
  }

  async executeSet(statements: SqliteStatement[]): Promise<void> {
    if (statements.length === 0) {
      return;
    }

    await this.db.executeSet(
      statements.map((entry) => ({ statement: entry.statement, values: entry.values })),
      false
    );
  }

  async beginTransaction(): Promise<void> {
    await this.db.beginTransaction();
  }

  async commitTransaction(): Promise<void> {
    await this.db.commitTransaction();
  }

  async rollbackTransaction(): Promise<void> {
    await this.db.rollbackTransaction();
  }

  async close(): Promise<void> {
    await this.sqlite.closeConnection(this.dbName, false);
  }
}

/**
 * Opens (and migrates) the native SQLite database via the Capacitor plugin.
 * Only call on native platforms.
 */
export async function openCapacitorSqliteConnection(): Promise<SqliteConnection> {
  const sqlite = new SQLiteConnection(CapacitorSQLite);

  await sqlite.addUpgradeStatement(SQLITE_DB_NAME, SQLITE_UPGRADE_STATEMENTS);

  const consistency = await sqlite.checkConnectionsConsistency();
  const isConnected = (await sqlite.isConnection(SQLITE_DB_NAME, false)).result ?? false;

  let db: SQLiteDBConnection;

  if (consistency.result && isConnected) {
    db = await sqlite.retrieveConnection(SQLITE_DB_NAME, false);
  } else {
    db = await sqlite.createConnection(
      SQLITE_DB_NAME,
      false,
      'no-encryption',
      SQLITE_SCHEMA_VERSION,
      false
    );
  }

  await db.open();

  return new CapacitorSqliteConnection(sqlite, db, SQLITE_DB_NAME);
}
