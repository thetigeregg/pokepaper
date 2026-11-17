import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { FastifyBaseLogger } from 'fastify';
import { vi } from 'vitest';
import { startBackupSchedule, writeBackup } from './backup.js';
import { memoryDb, settingsOp } from './test-helpers.js';
import { SyncStore } from './sync/store.js';

function fakeLog(): FastifyBaseLogger {
  return { info: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;
}

describe('backups', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pokepaper-backups-'));
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a readable snapshot containing the data', () => {
    const db = memoryDb();
    new SyncStore(db).push([settingsOp({ payload: { cardLanguage: 'ja' } })]);

    const file = writeBackup(db, dir, 5);

    const snapshot = new Database(file, { readonly: true });
    expect(snapshot.prepare('SELECT payload FROM entity_changes').get()).toEqual({
      payload: '{"cardLanguage":"ja"}',
    });
    snapshot.close();
  });

  it('keeps only the newest snapshots', () => {
    const db = memoryDb();

    for (let day = 1; day <= 4; day++) {
      writeBackup(db, dir, 2, new Date(Date.UTC(2026, 0, day)));
    }

    expect(readdirSync(dir).sort()).toEqual([
      'pokepaper-20260103T000000000Z.db',
      'pokepaper-20260104T000000000Z.db',
    ]);
  });

  it('backs up at startup and on the interval until stopped', () => {
    vi.useFakeTimers();
    const log = fakeLog();

    const stop = startBackupSchedule({
      db: memoryDb(),
      backupDir: dir,
      keep: 10,
      intervalHours: 1,
      log,
    });
    expect(log.info).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 1000);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(log.info).toHaveBeenCalledTimes(2);

    stop();
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(log.info).toHaveBeenCalledTimes(2);
  });

  it('backs up only at startup when the interval is 0', () => {
    vi.useFakeTimers();
    const log = fakeLog();

    startBackupSchedule({ db: memoryDb(), backupDir: dir, keep: 10, intervalHours: 0, log })();
    vi.advanceTimersByTime(48 * 60 * 60 * 1000);

    expect(log.info).toHaveBeenCalledTimes(1);
  });

  it('logs and survives a failed backup', () => {
    const db = memoryDb();
    db.close();
    const log = fakeLog();

    startBackupSchedule({ db, backupDir: dir, keep: 10, intervalHours: 0, log });

    expect(log.error).toHaveBeenCalledWith(expect.anything(), 'backup.failed');
  });
});
