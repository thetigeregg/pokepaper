import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

export const DB_FILENAME = 'pokepaper.db';
const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations');
const MIGRATION_FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export interface Migration {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

/** Loads `NNNN_name.sql` files in version order. */
export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  const migrations = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => {
      const match = MIGRATION_FILE.exec(file);
      if (!match) {
        throw new Error(`Migration file "${file}" must be named NNNN_snake_case.sql`);
      }

      const sql = readFileSync(join(dir, file), 'utf8');
      return {
        version: Number(match[1]),
        name: match[2],
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    })
    .sort((a, b) => a.version - b.version);

  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(
        `Migrations must be numbered 0001, 0002, … without gaps (found ${String(migration.version)} at position ${String(index + 1)})`
      );
    }
  });

  return migrations;
}

/**
 * Applies pending migrations, each in its own transaction. Migrations are
 * append-only: an applied migration whose file has since changed is a hard
 * error (fix forward with a new migration instead).
 */
export function migrate(db: Db, migrations: Migration[] = loadMigrations()): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  const applied = new Map(
    (
      db.prepare('SELECT version, checksum FROM schema_migrations').all() as {
        version: number;
        checksum: string;
      }[]
    ).map((row) => [row.version, row.checksum])
  );

  const newlyApplied: number[] = [];

  for (const migration of migrations) {
    const appliedChecksum = applied.get(migration.version);
    if (appliedChecksum !== undefined) {
      if (appliedChecksum !== migration.checksum) {
        throw new Error(
          `Migration ${String(migration.version)}_${migration.name} was modified after being applied; add a new migration instead`
        );
      }
      continue;
    }

    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare(
        'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)'
      ).run(migration.version, migration.name, migration.checksum, new Date().toISOString());
    })();
    newlyApplied.push(migration.version);
  }

  return newlyApplied;
}

/** Opens (creating if needed) and migrates the database. Pass `':memory:'` in tests. */
export function openDatabase(location: string, migrations?: Migration[]): Db {
  if (location !== ':memory:') {
    mkdirSync(join(location, '..'), { recursive: true });
  }

  const db = new Database(location);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db, migrations);
  return db;
}
