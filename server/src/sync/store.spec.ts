import type { SyncPullResponse } from '@pokepaper/shared';
import type { Db } from '../db.js';
import { memoryDb, settingsOp } from '../test-helpers.js';
import { SyncStore } from './store.js';

function epochOf(db: Db): string {
  return (
    db.prepare("SELECT value FROM server_meta WHERE key = 'epoch'").get() as { value: string }
  ).value;
}

function payloads(response: SyncPullResponse): unknown[] {
  return response.changes.map((change) => change.payload);
}

describe('SyncStore', () => {
  let db: Db;
  let store: SyncStore;

  beforeEach(() => {
    db = memoryDb();
    store = new SyncStore(db);
  });

  it('applies an upsert and serves it from a pull with an epoch-scoped cursor', () => {
    const op = settingsOp({ payload: { cardLanguage: 'ja' } });

    expect(store.push([op])).toEqual([{ opId: op.opId, status: 'applied' }]);

    const pulled = store.pull('0');
    expect(pulled.cursor).toBe(`${epochOf(db)}:1`);
    expect(pulled.hasMore).toBe(false);
    expect(pulled.changes).toEqual([
      expect.objectContaining({
        entityType: 'settings',
        entityId: 'settings',
        operation: 'upsert',
        payload: { cardLanguage: 'ja' },
      }),
    ]);
    expect(store.pull(pulled.cursor)).toEqual({
      cursor: pulled.cursor,
      changes: [],
      hasMore: false,
    });
  });

  it('is idempotent per opId', () => {
    const op = settingsOp();

    store.push([op]);
    expect(store.push([op])).toEqual([{ opId: op.opId, status: 'duplicate' }]);
    expect(store.pull('0').changes).toHaveLength(1);
  });

  it('keeps the newest write per entity regardless of arrival order (last-writer-wins)', () => {
    const newer = settingsOp({
      payload: { cardLanguage: 'de' },
      clientTimestamp: '2026-01-02T00:00:00.000Z',
    });
    const older = settingsOp({
      payload: { cardLanguage: 'fr' },
      clientTimestamp: '2026-01-01T00:00:00.000Z',
    });

    store.push([newer]);
    expect(store.push([older])).toEqual([{ opId: older.opId, status: 'applied' }]);

    expect(payloads(store.pull('0'))).toEqual([{ cardLanguage: 'de' }]);
  });

  it('re-issues the winning value when a stale op loses, so its sender pulls the winner back', () => {
    // Device A's newer write lands first; device B pulls past it while B
    // still has its own (older) write queued, so B skips A's change.
    store.push([
      settingsOp({ payload: { cardLanguage: 'de' }, clientTimestamp: '2026-01-02T00:00:00.000Z' }),
    ]);
    const deviceBCursor = store.pull('0').cursor;

    // B then pushes its older write, which loses.
    store.push([
      settingsOp({ payload: { cardLanguage: 'fr' }, clientTimestamp: '2026-01-01T00:00:00.000Z' }),
    ]);

    // B's next pull must bring A's winning value back.
    const next = store.pull(deviceBCursor);
    expect(payloads(next)).toEqual([{ cardLanguage: 'de' }]);
    expect(next.cursor).not.toBe(deviceBCursor);
    expect(store.pull('0').changes).toHaveLength(1);
  });

  it('applies an equal-timestamp write (not older) and moves the entity to a new seq', () => {
    store.push([settingsOp({ payload: { cardLanguage: 'de' } })]);
    const first = store.pull('0').cursor;

    store.push([settingsOp({ payload: { cardLanguage: 'it' } })]);
    const after = store.pull(first);

    expect(payloads(after)).toEqual([{ cardLanguage: 'it' }]);
    expect(store.pull('0').changes).toHaveLength(1);
  });

  it('keeps deletes as tombstones with a null payload', () => {
    store.push([settingsOp()]);
    store.push([
      settingsOp({
        operation: 'delete',
        payload: { ignored: true },
        clientTimestamp: '2026-01-02T00:00:00.000Z',
      }),
    ]);

    expect(store.pull('0').changes).toEqual([
      expect.objectContaining({ operation: 'delete', payload: null }),
    ]);
  });

  it.each([
    ['a missing entityType', { entityType: undefined }, /entityType must be/],
    ['a wrong settings entityId', { entityId: 'other' }, /Invalid entityId/],
    ['an empty entityId', { entityId: '' }, /entityId must be a string/],
    ['a non-string entityId', { entityId: 7 }, /entityId must be a string/],
    ['an unknown operation', { operation: 'patch' }, /operation must be/],
    ['an invalid payload', { payload: { cardLanguage: 7 } }, /Invalid settings payload/],
  ])('permanently rejects %s, without remembering it', (_label, overrides, message) => {
    const op = { ...settingsOp(), ...overrides };

    const [first] = store.push([op]);
    expect(first).toEqual({
      opId: op.opId,
      status: 'failed',
      message: expect.stringMatching(message) as string,
    });
    expect(store.pull('0').changes).toEqual([]);

    // Not cached: the same opId is re-validated on the next attempt.
    expect(db.prepare('SELECT COUNT(*) AS n FROM applied_operations').get()).toEqual({ n: 0 });
  });

  it.each([
    ['a timestamp without a zone', '2026-01-01T00:00:00'],
    ['a space-separated timestamp', '2026-01-01 00:00:00Z'],
    ['a loose date string', 'Jan 1 2026'],
    ['a bare number', '1'],
    ['an offset instead of Z', '2026-01-01T00:00:00+01:00'],
    ['an impossible date', '2026-13-45T00:00:00.000Z'],
  ])('rejects %s as clientTimestamp', (_label, clientTimestamp) => {
    const [result] = store.push([settingsOp({ clientTimestamp })]);

    expect(result).toMatchObject({
      status: 'failed',
      message: expect.stringMatching(/UTC ISO 8601/) as string,
    });
  });

  it('marks unknown entity types as retryable so newer clients keep the op queued', () => {
    const op = settingsOp({ entityType: 'decks' as never, entityId: 'deck-1' });

    expect(store.push([op])).toEqual([
      { opId: op.opId, status: 'failed', message: 'Unknown entity type "decks"', retryable: true },
    ]);
  });

  it('accepts an op it once rejected after the data becomes valid for it (rejections are not cached)', () => {
    const op = settingsOp({ payload: { cardLanguage: 7 } });
    expect(store.push([op])[0]?.status).toBe('failed');

    // Same opId, now valid (stands in for a server upgrade changing the rules).
    expect(store.push([{ ...op, payload: { cardLanguage: 'ko' } }])).toEqual([
      { opId: op.opId, status: 'applied' },
    ]);
  });

  it('returns results in request order for mixed batches', () => {
    const good = settingsOp();
    const bad = settingsOp({ entityId: 'nope' });

    expect(store.push([good, bad]).map((result) => result.status)).toEqual(['applied', 'failed']);
  });

  it('pages pulls and reports hasMore', () => {
    const insert = db.prepare(
      `INSERT INTO entity_changes (entity_type, entity_id, operation, payload, client_timestamp, server_timestamp)
       VALUES ('settings', ?, 'upsert', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
    );
    for (let index = 0; index < 5; index++) {
      insert.run(`entity-${String(index)}`);
    }

    const first = store.pull('0', 2);
    const second = store.pull(first.cursor, 2);
    const third = store.pull(second.cursor, 2);

    expect([first.changes.length, second.changes.length, third.changes.length]).toEqual([2, 2, 1]);
    expect([first.hasMore, second.hasMore, third.hasMore]).toEqual([true, true, false]);
  });

  it.each([
    ['another epoch', () => 'deadbeef:1'],
    ['a malformed cursor', () => 'not-a-cursor'],
    ['a legacy numeric cursor', () => '5'],
    ['a seq beyond anything issued', (db: Db) => `${epochOf(db)}:999`],
  ])('rewinds a client presenting %s', (_label, cursorFor) => {
    store.push([settingsOp()]);

    expect(store.pull(cursorFor(db))).toEqual({ cursor: '0', changes: [], hasMore: true });
  });

  it('treats cursor 0 on an empty database as up to date', () => {
    expect(store.pull('0')).toEqual({ cursor: `${epochOf(db)}:0`, changes: [], hasMore: false });
  });

  it('refuses to start on a database without an epoch', () => {
    db.prepare("DELETE FROM server_meta WHERE key = 'epoch'").run();

    expect(() => new SyncStore(db)).toThrow(/epoch is missing/);
  });
});
