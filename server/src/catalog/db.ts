import { join } from 'node:path';
import { loadMigrations, openDatabase, type Db } from '../db.js';

export const CATALOG_DB_FILENAME = 'catalog.db';
const CATALOG_MIGRATIONS_DIR = join(import.meta.dirname, 'migrations');

/**
 * Opens (creating and migrating if needed) the catalog database, kept
 * apart from `pokepaper.db` because it can be rebuilt from TCGdex. Pass
 * `':memory:'` in tests.
 */
export function openCatalogDatabase(location: string): Db {
  return openDatabase(location, loadMigrations(CATALOG_MIGRATIONS_DIR));
}
