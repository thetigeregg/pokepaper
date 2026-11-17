/**
 * Runs one catalogue import by hand: `npm run catalog:sync --workspace server
 * [-- --full]`. Uses the same configuration as the server (DATA_DIR,
 * CATALOG_LANGUAGES). Safe while the server runs: SQLite serializes writes.
 */
import { join } from 'node:path';
import { loadConfig } from '../config.js';
import { CATALOG_DB_FILENAME, openCatalogDatabase } from './db.js';
import { runCatalogIngest, type CatalogLogger } from './ingest.js';
import { CatalogStore } from './store.js';
import { TcgdexClient } from './tcgdex-client.js';

// Errors' message and stack aren't enumerable, so JSON.stringify would drop them.
const serializeErrors = (_key: string, value: unknown): unknown =>
  value instanceof Error ? { name: value.name, message: value.message } : value;

const write =
  (stream: NodeJS.WriteStream) =>
  (obj: object, msg: string): void => {
    stream.write(`${new Date().toISOString()} ${msg} ${JSON.stringify(obj, serializeErrors)}\n`);
  };
const log: CatalogLogger = {
  info: write(process.stdout),
  warn: write(process.stderr),
  error: write(process.stderr),
};

const config = loadConfig();
const db = openCatalogDatabase(join(config.dataDir, CATALOG_DB_FILENAME));
const controller = new AbortController();
process.once('SIGINT', () => {
  controller.abort(new Error('Interrupted'));
});

try {
  await runCatalogIngest({
    store: new CatalogStore(db),
    client: new TcgdexClient({ signal: controller.signal }),
    languages: config.catalog.languages,
    kind: process.argv.includes('--full') ? 'full' : 'light',
    log,
    signal: controller.signal,
  });
} catch {
  process.exitCode = 1;
} finally {
  db.close();
}
