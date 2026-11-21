/**
 * Runs one catalog import by hand: `npm run catalog:sync --workspace server
 * [-- --full]`, a price pass with `-- --prices`, or an exchange rates
 * refresh with `-- --rates`. Uses the same
 * configuration as the server (DATA_DIR, CATALOG_LANGUAGES). Safe while the
 * server runs: SQLite serializes writes.
 */
import { join } from 'node:path';
import { loadConfig } from '../config.js';
import { CATALOG_DB_FILENAME, openCatalogDatabase } from './db.js';
import { runCatalogIngest, type CatalogLogger } from './ingest.js';
import { runPriceRefresh } from './prices.js';
import { refreshExchangeRates } from './rates.js';
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
  const options = {
    store: new CatalogStore(db),
    client: new TcgdexClient({ signal: controller.signal }),
    languages: config.catalog.languages,
    log,
    signal: controller.signal,
  };
  if (process.argv.includes('--rates')) {
    if (!(await refreshExchangeRates(options))) {
      log.info({ date: options.store.getExchangeRates()?.date ?? null }, 'catalog.rates_unchanged');
    }
  } else if (process.argv.includes('--prices')) {
    await runPriceRefresh(options);
  } else {
    await runCatalogIngest({
      ...options,
      kind: process.argv.includes('--full') ? 'full' : 'light',
    });
  }
} catch {
  process.exitCode = 1;
} finally {
  db.close();
}
