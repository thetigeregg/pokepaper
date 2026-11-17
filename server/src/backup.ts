import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from './db.js';

const BACKUP_FILE = /^pokepaper-\d{8}T\d{6}(\d{3})?Z\.db$/;

function backupFilename(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('.', '');
  return `pokepaper-${stamp}.db`;
}

/**
 * Writes a consistent snapshot with `VACUUM INTO` (safe while the database
 * is in use) and deletes all but the newest `keep` snapshots.
 */
export function writeBackup(db: Db, backupDir: string, keep: number, now = new Date()): string {
  mkdirSync(backupDir, { recursive: true });
  const target = join(backupDir, backupFilename(now));
  db.prepare('VACUUM INTO ?').run(target);

  const snapshots = readdirSync(backupDir)
    .filter((file) => BACKUP_FILE.test(file))
    .sort();
  for (const stale of snapshots.slice(0, Math.max(0, snapshots.length - keep))) {
    rmSync(join(backupDir, stale));
  }

  return target;
}

export interface BackupScheduleOptions {
  db: Db;
  backupDir: string;
  keep: number;
  intervalHours: number;
  log: FastifyBaseLogger;
}

/** Backs up once now, then every `intervalHours` (0 = startup only). Returns a stop function. */
export function startBackupSchedule(options: BackupScheduleOptions): () => void {
  const run = (): void => {
    try {
      const file = writeBackup(options.db, options.backupDir, options.keep);
      options.log.info({ file }, 'backup.written');
    } catch (error: unknown) {
      options.log.error({ err: error }, 'backup.failed');
    }
  };

  run();

  if (options.intervalHours <= 0) {
    return () => undefined;
  }

  const timer = setInterval(run, options.intervalHours * 60 * 60 * 1000);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}
