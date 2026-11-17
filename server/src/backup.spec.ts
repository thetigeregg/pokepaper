import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { FastifyBaseLogger } from 'fastify';
import { vi } from 'vitest';
import { listBackups, startBackupSchedule, writeBackup } from './backup.js';
import { openDatabase } from './db.js';
import { SyncStore } from './sync/store.js';
import { memoryDb, settingsOp } from './test-helpers.js';

interface FakeLog {
  info: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

function fakeLog(): FakeLog & FastifyBaseLogger {
  return { info: vi.fn(), error: vi.fn() } as unknown as FakeLog & FastifyBaseLogger;
}

function epochOf(db: Database.Database): string {
  return (
    db.prepare("SELECT value FROM server_meta WHERE key = 'epoch'").get() as { value: string }
  ).value;
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

  it('writes a readable snapshot containing the data, with a fresh epoch', async () => {
    const db = memoryDb();
    new SyncStore(db).push([settingsOp({ payload: { cardLanguage: 'ja' } })]);

    const file = await writeBackup(db, dir, 5);

    const snapshot = new Database(file, { readonly: true });
    expect(snapshot.prepare('SELECT payload FROM entity_changes').get()).toEqual({
      payload: '{"cardLanguage":"ja"}',
    });
    expect(epochOf(snapshot)).not.toBe(epochOf(db));
    snapshot.close();
  });

  it('a database restored from a snapshot rewinds clients that synced against the original', async () => {
    const live = memoryDb();
    const liveStore = new SyncStore(live);
    liveStore.push([settingsOp()]);
    const file = await writeBackup(live, dir, 5);

    // The live database moves on; a client syncs well past the snapshot...
    for (let index = 0; index < 5; index++) {
      liveStore.push([
        settingsOp({ clientTimestamp: `2026-01-0${String(index + 2)}T00:00:00.000Z` }),
      ]);
    }
    const clientCursor = liveStore.pull('0').cursor;

    // ...then the snapshot is restored and new writes push its seq past the cursor.
    const restored = openDatabase(file);
    const restoredStore = new SyncStore(restored);
    for (let index = 0; index < 10; index++) {
      restoredStore.push([
        settingsOp({ clientTimestamp: `2026-02-${String(index + 10)}T00:00:00.000Z` }),
      ]);
    }

    expect(restoredStore.pull(clientCursor)).toEqual({ cursor: '0', changes: [], hasMore: true });
    restored.close();
  });

  it('keeps only the newest snapshots', async () => {
    const db = memoryDb();

    for (let day = 1; day <= 4; day++) {
      await writeBackup(db, dir, 2, new Date(Date.UTC(2026, 0, day)));
    }

    expect(readdirSync(dir).sort()).toEqual([
      'pokepaper-20260103T000000000Z.db',
      'pokepaper-20260104T000000000Z.db',
    ]);
  });

  it('lists snapshots oldest first and ignores unrelated files', () => {
    writeFileSync(join(dir, 'pokepaper-20260102T000000000Z.db'), '');
    writeFileSync(join(dir, 'pokepaper-20260101T000000000Z.db'), '');
    writeFileSync(join(dir, 'notes.txt'), '');

    expect(listBackups(dir).map((entry) => entry.file)).toEqual([
      'pokepaper-20260101T000000000Z.db',
      'pokepaper-20260102T000000000Z.db',
    ]);
    expect(listBackups(join(dir, 'missing'))).toEqual([]);
  });

  it('backs up at startup and on the interval until stopped', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const log = fakeLog();

    const stop = startBackupSchedule({
      db: memoryDb(),
      backupDir: dir,
      keep: 10,
      intervalHours: 1,
      log,
    });
    await vi.waitFor(() => {
      expect(log.info).toHaveBeenCalledWith(expect.anything(), 'backup.written');
    });

    vi.advanceTimersByTime(60 * 60 * 1000);
    await vi.waitFor(() => {
      expect(readdirSync(dir)).toHaveLength(2);
    });

    stop();
    vi.advanceTimersByTime(60 * 60 * 1000);
    await new Promise((resolve) => setImmediate(resolve));
    expect(readdirSync(dir)).toHaveLength(2);
  });

  it('skips the startup backup when a snapshot is newer than the interval (restart loops)', () => {
    const log = fakeLog();
    const recent = new Date(Date.now() - 10 * 60 * 1000);
    writeFileSync(
      join(dir, `pokepaper-${recent.toISOString().replace(/[-:]/g, '').replace('.', '')}.db`),
      ''
    );

    startBackupSchedule({ db: memoryDb(), backupDir: dir, keep: 10, intervalHours: 24, log })();

    expect(log.info).toHaveBeenCalledWith(expect.anything(), 'backup.startup_skipped_recent');
    expect(readdirSync(dir)).toHaveLength(1);
  });

  it('backs up at startup when the newest snapshot is older than the interval', async () => {
    const log = fakeLog();
    writeFileSync(join(dir, 'pokepaper-20200101T000000000Z.db'), '');

    startBackupSchedule({ db: memoryDb(), backupDir: dir, keep: 10, intervalHours: 24, log })();

    await vi.waitFor(() => {
      expect(readdirSync(dir)).toHaveLength(2);
    });
  });

  it('logs and survives a failed backup', async () => {
    const db = memoryDb();
    db.close();
    const log = fakeLog();

    startBackupSchedule({ db, backupDir: dir, keep: 10, intervalHours: 0, log });

    await vi.waitFor(() => {
      expect(log.error).toHaveBeenCalledWith(expect.anything(), 'backup.failed');
    });
  });
});
