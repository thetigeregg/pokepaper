import { join } from 'node:path';
import { buildApp } from './app.js';
import { startBackupSchedule } from './backup.js';
import { CATALOG_DB_FILENAME, openCatalogDatabase } from './catalog/db.js';
import { CatalogImageCache } from './catalog/image-cache.js';
import { startCatalogSchedule, type CatalogSchedule } from './catalog/schedule.js';
import { CatalogStore } from './catalog/store.js';
import { loadConfig } from './config.js';
import { DB_FILENAME, openDatabase } from './db.js';

const config = loadConfig();
const db = openDatabase(join(config.dataDir, DB_FILENAME));
const catalogDb = openCatalogDatabase(join(config.dataDir, CATALOG_DB_FILENAME));
const catalogStore = new CatalogStore(catalogDb);
const app = buildApp({
  db,
  auth: config.auth,
  trustProxyHops: config.trustProxyHops,
  clientIpHeader: config.clientIpHeader,
  logLevel: config.logLevel,
  rateLimitPerMinute: config.rateLimitPerMinute,
  catalog: {
    store: catalogStore,
    images: new CatalogImageCache({ dir: join(config.dataDir, 'images', 'catalog') }),
    languages: config.catalog.languages,
  },
});

const stopBackups = startBackupSchedule({
  db,
  backupDir: config.backupDir,
  keep: config.backupKeep,
  intervalHours: config.backupIntervalHours,
  log: app.log,
});

// The catalogue (catalog.db) is rebuilt from TCGdex rather than backed up.
const catalogSchedule: CatalogSchedule | null = config.catalog.syncEnabled
  ? startCatalogSchedule({
      store: catalogStore,
      languages: config.catalog.languages,
      refreshHours: config.catalog.refreshHours,
      fullRefreshDays: config.catalog.fullRefreshDays,
      log: app.log,
    })
  : null;

const closeDatabases = (): void => {
  db.close();
  catalogDb.close();
};

if (config.auth.devBypass) {
  app.log.warn(
    'AUTH_DEV_BYPASS is on: every request is treated as signed in (local development only)'
  );
}

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error: unknown) {
  app.log.error({ err: error }, 'server.listen_failed');
  stopBackups();
  await catalogSchedule?.stop();
  closeDatabases();
  process.exit(1);
}

// Graceful shutdown: stop timers, finish in-flight requests, then close the
// database so the WAL is checkpointed. Also lets `tsx watch` restart quickly.
let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    stopBackups();
    Promise.all([app.close(), catalogSchedule?.stop()])
      .catch((error: unknown) => {
        app.log.error({ err: error }, 'server.close_failed');
      })
      .finally(() => {
        closeDatabases();
        process.exit(0);
      });
  });
}
