import { join } from 'node:path';
import { buildApp } from './app.js';
import { startBackupSchedule } from './backup.js';
import { loadConfig } from './config.js';
import { DB_FILENAME, openDatabase } from './db.js';

const config = loadConfig();
const db = openDatabase(join(config.dataDir, DB_FILENAME));
const app = buildApp({
  db,
  trustProxyHops: config.trustProxyHops,
  clientIpHeader: config.clientIpHeader,
  logLevel: config.logLevel,
  rateLimitPerMinute: config.rateLimitPerMinute,
});

const stopBackups = startBackupSchedule({
  db,
  backupDir: config.backupDir,
  keep: config.backupKeep,
  intervalHours: config.backupIntervalHours,
  log: app.log,
});

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error: unknown) {
  app.log.error({ err: error }, 'server.listen_failed');
  stopBackups();
  db.close();
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
    app
      .close()
      .catch((error: unknown) => {
        app.log.error({ err: error }, 'server.close_failed');
      })
      .finally(() => {
        db.close();
        process.exit(0);
      });
  });
}
