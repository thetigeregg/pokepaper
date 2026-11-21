import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMigrations, openDatabase } from '../db.js';
import { openCatalogDatabase } from './db.js';

describe('catalog migrations', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pokepaper-catalog-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('bump every prices version once when packs gain product IDs', () => {
    const location = join(dir, 'catalog.db');
    const before = loadMigrations(join(import.meta.dirname, 'migrations')).filter(
      (migration) => migration.version < 4
    );
    const old = openDatabase(location, before);
    old
      .prepare('INSERT INTO catalog_meta (key, value) VALUES (?, ?), (?, ?)')
      .run('prices_version:intl', '190', 'prices_version:asia', '91');
    old.close();

    const db = openCatalogDatabase(location);
    const versions = db
      .prepare("SELECT key, value FROM catalog_meta WHERE key LIKE 'prices_version:%' ORDER BY key")
      .all();
    db.close();

    expect(versions).toEqual([
      { key: 'prices_version:asia', value: '92' },
      { key: 'prices_version:intl', value: '191' },
    ]);
  });
});
