import { memoryDb, settingsOp } from '../test-helpers.js';
import { SyncStore } from './store.js';

describe('SyncStore', () => {
  let store: SyncStore;

  beforeEach(() => {
    store = new SyncStore(memoryDb());
  });

  it('applies an upsert and serves it from a pull', () => {
    const op = settingsOp({ payload: { cardLanguage: 'ja' } });

    expect(store.push([op])).toEqual([{ opId: op.opId, status: 'applied' }]);

    const pulled = store.pull(0);
    expect(pulled.hasMore).toBe(false);
    expect(pulled.changes).toEqual([
      expect.objectContaining({
        entityType: 'settings',
        entityId: 'settings',
        operation: 'upsert',
        payload: { cardLanguage: 'ja' },
      }),
    ]);
    expect(store.pull(Number(pulled.cursor))).toEqual({
      cursor: pulled.cursor,
      changes: [],
      hasMore: false,
    });
  });

  it('is idempotent per opId', () => {
    const op = settingsOp();

    store.push([op]);
    expect(store.push([op])).toEqual([{ opId: op.opId, status: 'duplicate' }]);
    expect(store.pull(0).changes).toHaveLength(1);
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
    const cursorAfterNewer = store.pull(0).cursor;

    // The stale op is acknowledged (so the client stops retrying) but ignored.
    expect(store.push([older])).toEqual([{ opId: older.opId, status: 'applied' }]);
    expect(store.pull(0).changes.map((change) => change.payload)).toEqual([{ cardLanguage: 'de' }]);
    expect(store.pull(Number(cursorAfterNewer)).changes).toEqual([]);
  });

  it('applies an equal-timestamp write (not older) and moves the entity to a new seq', () => {
    store.push([settingsOp({ payload: { cardLanguage: 'de' } })]);
    const first = store.pull(0).cursor;

    store.push([settingsOp({ payload: { cardLanguage: 'it' } })]);
    const after = store.pull(Number(first));

    expect(after.changes.map((change) => change.payload)).toEqual([{ cardLanguage: 'it' }]);
    expect(Number(after.cursor)).toBeGreaterThan(Number(first));
    expect(store.pull(0).changes).toHaveLength(1);
  });

  it('keeps deletes as tombstones with a null payload', () => {
    store.push([settingsOp()]);
    store.push([
      settingsOp({
        operation: 'delete',
        payload: null,
        clientTimestamp: '2026-01-02T00:00:00.000Z',
      }),
    ]);

    expect(store.pull(0).changes).toEqual([
      expect.objectContaining({ operation: 'delete', payload: null }),
    ]);
  });

  it.each([
    ['an unknown entity type', { entityType: 'decks' as never }, /Unknown entity type/],
    ['a wrong settings entityId', { entityId: 'other' }, /Invalid entityId/],
    ['an empty entityId', { entityId: '' }, /1-200 characters/],
    ['an invalid timestamp', { clientTimestamp: 'yesterday' }, /ISO 8601/],
    ['an invalid payload', { payload: { cardLanguage: 7 } }, /Invalid settings payload/],
  ])('permanently rejects %s, and keeps rejecting the same opId', (_label, overrides, message) => {
    const op = settingsOp(overrides);

    const [first] = store.push([op]);
    expect(first).toMatchObject({ opId: op.opId, status: 'failed' });
    expect(first.message).toMatch(message);
    expect(store.push([op])[0]).toMatchObject({ status: 'failed', message: first.message });
    expect(store.pull(0).changes).toEqual([]);
  });

  it('returns results in request order for mixed batches', () => {
    const good = settingsOp();
    const bad = settingsOp({ entityType: 'decks' as never });

    expect(store.push([good, bad]).map((result) => result.status)).toEqual(['applied', 'failed']);
  });

  it('pages pulls and reports hasMore', () => {
    const db = memoryDb();
    const paged = new SyncStore(db);
    const insert = db.prepare(
      `INSERT INTO entity_changes (entity_type, entity_id, operation, payload, client_timestamp, server_timestamp)
       VALUES ('settings', ?, 'upsert', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
    );
    for (let index = 0; index < 5; index++) {
      insert.run(`entity-${String(index)}`);
    }

    const first = paged.pull(0, 2);
    const second = paged.pull(Number(first.cursor), 2);
    const third = paged.pull(Number(second.cursor), 2);

    expect([first.changes.length, second.changes.length, third.changes.length]).toEqual([2, 2, 1]);
    expect([first.hasMore, second.hasMore, third.hasMore]).toEqual([true, true, false]);
  });

  it('rewinds a client whose cursor is ahead of anything this database issued', () => {
    store.push([settingsOp()]);

    expect(store.pull(999)).toEqual({ cursor: '0', changes: [], hasMore: true });
  });

  it('treats cursor 0 on an empty database as up to date', () => {
    expect(store.pull(0)).toEqual({ cursor: '0', changes: [], hasMore: false });
  });
});
