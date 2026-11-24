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

  it('start each card’s Cardmarket product from the IDs stored with its prices', () => {
    const location = join(dir, 'catalog.db');
    const before = loadMigrations(join(import.meta.dirname, 'migrations')).filter(
      (migration) => migration.version < 5
    );
    const old = openDatabase(location, before);
    const insert = old.prepare(
      'INSERT INTO catalog_prices (region, card_id, payload) VALUES (?, ?, ?)'
    );
    insert.run('intl', 'sv01-001', JSON.stringify({ updated: 'x', idProduct: 483559 }));
    insert.run('asia', 'SV2a-001', JSON.stringify({ updated: 'x', idProduct: 700001 }));
    insert.run('intl', 'no-id', JSON.stringify({ updated: 'x', idProduct: null }));
    insert.run('intl', 'bad-id', JSON.stringify({ updated: 'x', idProduct: -4 }));
    old.close();

    const db = openCatalogDatabase(location);
    const products = db
      .prepare(
        'SELECT region, card_id, id_product FROM catalog_cardmarket_products ORDER BY card_id'
      )
      .all();
    db.close();

    expect(products).toEqual([
      { region: 'asia', card_id: 'SV2a-001', id_product: 700001 },
      { region: 'intl', card_id: 'sv01-001', id_product: 483559 },
    ]);
  });

  it('forget the price guide last applied, so the next pass downloads and keeps it', () => {
    const location = join(dir, 'catalog.db');
    const before = loadMigrations(join(import.meta.dirname, 'migrations')).filter(
      (migration) => migration.version < 6
    );
    const old = openDatabase(location, before);
    old
      .prepare('INSERT INTO catalog_meta (key, value) VALUES (?, ?), (?, ?)')
      .run('price_guide', '{"etag":"\"x\""}', 'products_version', '4');
    old.close();

    const db = openCatalogDatabase(location);
    const meta = db.prepare('SELECT key, value FROM catalog_meta ORDER BY key').all();
    db.close();

    expect(meta).toEqual([
      { key: 'products_version', value: '4' },
      { key: 'version', value: '0' },
    ]);
  });
});
