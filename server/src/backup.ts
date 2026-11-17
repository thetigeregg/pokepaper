import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from './db.js';

const BACKUP_FILE = /^pokepaper-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z\.db$/;
const HOUR_MS = 60 * 60 * 1000;

function backupFilename(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('.', '');
  return `pokepaper-${stamp}.db`;
}

/** Snapshot files in `backupDir`, oldest first, with the time encoded in their names. */
export function listBackups(backupDir: string): { file: string; takenAt: Date }[] {
  let files: string[];
  try {
    files = readdirSync(backupDir);
  } catch {
    return [];
  }

  return files
    .map((file) => {
      const m = BACKUP_FILE.exec(file);
      return m
        ? {
            file,
            takenAt: new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7]}Z`),
          }
        : null;
    })
    .filter((entry): entry is { file: string; takenAt: Date } => entry !== null)
    .sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
}

/**
 * Writes a consistent snapshot with SQLite's online backup API, which
 * copies in small steps between event-loop turns instead of blocking the
 * server for the whole copy. The snapshot then gets a fresh sync epoch, so a
 * database restored from it never matches clients' cursors (they re-pull
 * everything). Finally deletes all but the newest `keep` snapshots.
 */
export async function writeBackup(
  db: Db,
  backupDir: string,
  keep: number,
  now = new Date()
): Promise<string> {
  mkdirSync(backupDir, { recursive: true });
  const target = join(backupDir, backupFilename(now));
  await db.backup(target);

  const snapshot = new Database(target);
  try {
    snapshot
      .prepare("UPDATE server_meta SET value = ? WHERE key = 'epoch'")
      .run(randomBytes(8).toString('hex'));
    snapshot.pragma('journal_mode = DELETE');
  } finally {
    snapshot.close();
  }

  const snapshots = listBackups(backupDir);
  for (const stale of snapshots.slice(0, Math.max(0, snapshots.length - keep))) {
    rmSync(join(backupDir, stale.file));
  }

  return target;
}

export interface BackupScheduleOptions {
  db: Db;
  backupDir: string;
  keep: number;
  /** Hours between backups; 0 = only at startup. */
  intervalHours: number;
  log: FastifyBaseLogger;
}

/**
 * Backs up at startup (unless a snapshot is already newer than the interval,
 * so restart loops can't rotate good snapshots out) and then every
 * `intervalHours`. Returns a stop function.
 */
export function startBackupSchedule(options: BackupScheduleOptions): () => void {
  let running = false;

  const run = async (): Promise<void> => {
    if (running) {
      return;
    }
    running = true;
    try {
      const file = await writeBackup(options.db, options.backupDir, options.keep);
      options.log.info({ file }, 'backup.written');
    } catch (error: unknown) {
      options.log.error({ err: error }, 'backup.failed');
    } finally {
      running = false;
    }
  };

  const freshnessMs = Math.max(options.intervalHours, 1) * HOUR_MS;
  const newest = listBackups(options.backupDir).at(-1);
  if (newest && Date.now() - newest.takenAt.getTime() < freshnessMs) {
    options.log.info({ file: newest.file }, 'backup.startup_skipped_recent');
  } else {
    void run();
  }

  if (options.intervalHours <= 0) {
    return () => undefined;
  }

  const timer = setInterval(() => void run(), options.intervalHours * HOUR_MS);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}
