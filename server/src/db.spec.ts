import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { loadMigrations, migrate, openDatabase, type Migration } from './db.js';

function migration(version: number, sql: string, checksum = `sum-${String(version)}`): Migration {
  return { version, name: `m${String(version)}`, sql, checksum };
}

describe('migrations', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pokepaper-migrations-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('ships a contiguous, loadable migration set', () => {
    const migrations = loadMigrations();

    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations.map((m) => m.version)).toEqual(migrations.map((_, index) => index + 1));
  });

  it('applies pending migrations once and records them', () => {
    const db = new Database(':memory:');
    const migrations = [
      migration(1, 'CREATE TABLE a (id INTEGER)'),
      migration(2, 'CREATE TABLE b (id INTEGER)'),
    ];

    expect(migrate(db, migrations)).toEqual([1, 2]);
    expect(migrate(db, migrations)).toEqual([]);
    expect(migrate(db, [...migrations, migration(3, 'CREATE TABLE c (id INTEGER)')])).toEqual([3]);
  });

  it('refuses to run when an applied migration was edited', () => {
    const db = new Database(':memory:');
    migrate(db, [migration(1, 'CREATE TABLE a (id INTEGER)')]);

    expect(() => migrate(db, [migration(1, 'CREATE TABLE a (id INTEGER)', 'changed')])).toThrow(
      /modified after being applied/
    );
  });

  it('rolls back a failing migration without recording it', () => {
    const db = new Database(':memory:');

    expect(() =>
      migrate(db, [migration(1, 'CREATE TABLE a (id INTEGER); CREATE TABLE broken (')])
    ).toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'a'").get()).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()).toEqual({ n: 0 });
  });

  it('rejects badly named or non-contiguous migration files', () => {
    writeFileSync(join(dir, '0001_first.sql'), 'SELECT 1;');
    writeFileSync(join(dir, '0003_third.sql'), 'SELECT 1;');
    expect(() => loadMigrations(dir)).toThrow(/without gaps/);

    rmSync(join(dir, '0003_third.sql'));
    writeFileSync(join(dir, 'second.sql'), 'SELECT 1;');
    expect(() => loadMigrations(dir)).toThrow(/NNNN_snake_case/);
  });

  it('checksums ignore CRLF vs LF line endings', () => {
    writeFileSync(
      join(dir, '0001_first.sql'),
      'CREATE TABLE a (id INTEGER);\nCREATE TABLE b (id INTEGER);\n'
    );
    const lf = loadMigrations(dir)[0]?.checksum;
    writeFileSync(
      join(dir, '0001_first.sql'),
      'CREATE TABLE a (id INTEGER);\r\nCREATE TABLE b (id INTEGER);\r\n'
    );
    const crlf = loadMigrations(dir)[0]?.checksum;

    expect(crlf).toBe(lf);
  });

  it('openDatabase creates the data directory and a migrated WAL database', () => {
    const db = openDatabase(join(dir, 'nested', 'pokepaper.db'));

    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'entity_changes'").get()
    ).toBeDefined();
    db.close();
  });
});
