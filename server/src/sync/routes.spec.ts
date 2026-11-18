import { settingsOp, testApp } from '../test-helpers.js';
import { MAX_PUSH_OPERATIONS } from './routes.js';

describe('sync routes', () => {
  it('push applies operations and pull returns them', async () => {
    const { app, headers } = testApp();
    const op = settingsOp({ payload: { cardLanguage: 'ko' } });

    const push = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers,
      payload: { operations: [op] },
    });
    expect(push.statusCode).toBe(200);
    expect(push.json()).toEqual({ results: [{ opId: op.opId, status: 'applied' }] });

    const pull = await app.inject({
      method: 'POST',
      url: '/api/sync/pull',
      headers,
      payload: { cursor: '0' },
    });
    expect(pull.statusCode).toBe(200);
    expect(pull.json()).toMatchObject({
      cursor: expect.stringMatching(/^[0-9a-f]+:1$/) as string,
      hasMore: false,
      changes: [{ entityType: 'settings', payload: { cardLanguage: 'ko' } }],
    });
  });

  it('syncs collection entries, and deletes them as tombstones', async () => {
    const { app, headers } = testApp();
    const entityId = 'intl:sv01-001:reverse:en';
    const payload = {
      region: 'intl',
      cardId: 'sv01-001',
      setId: 'sv01',
      variant: 'reverse',
      language: 'en',
      quantity: 2,
    };
    const upsert = settingsOp({ entityType: 'collectionEntry', entityId, payload });
    const remove = settingsOp({
      entityType: 'collectionEntry',
      entityId,
      operation: 'delete',
      payload: null,
      clientTimestamp: '2026-01-02T00:00:00.000Z',
    });

    const pushes = [];
    for (const op of [upsert, remove]) {
      const push = await app.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers,
        payload: { operations: [op] },
      });
      pushes.push(push.json());
    }
    expect(pushes).toEqual([
      { results: [{ opId: upsert.opId, status: 'applied' }] },
      { results: [{ opId: remove.opId, status: 'applied' }] },
    ]);

    const pull = await app.inject({
      method: 'POST',
      url: '/api/sync/pull',
      headers,
      payload: { cursor: '0' },
    });
    expect(pull.json()).toMatchObject({
      changes: [{ entityType: 'collectionEntry', entityId, operation: 'delete', payload: null }],
    });
  });

  it('pull without a cursor starts from the beginning', async () => {
    const { app, headers } = testApp();

    const pull = await app.inject({ method: 'POST', url: '/api/sync/pull', headers, payload: {} });

    expect(pull.statusCode).toBe(200);
    expect(pull.json()).toMatchObject({ changes: [], hasMore: false });
  });

  it('fails only the malformed operation, not the whole push', async () => {
    const { app, headers } = testApp();
    const good = settingsOp();
    const malformed = {
      opId: 'malformed',
      entityType: 'x'.repeat(500),
      clientTimestamp: 'y'.repeat(500),
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers,
      payload: { operations: [good, malformed] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ results: { status: string }[] }>().results.map((r) => r.status)).toEqual(
      ['applied', 'failed']
    );
  });

  it.each([
    ['a missing operations array', {}],
    ['operations that is not an array', { operations: 'nope' }],
    ['an operation without an opId', { operations: [{ entityType: 'settings' }] }],
    ['an operation with an empty opId', { operations: [{ opId: '' }] }],
    [
      'too many operations',
      { operations: Array.from({ length: MAX_PUSH_OPERATIONS + 1 }, () => settingsOp()) },
    ],
  ])(
    'push rejects %s with 400 (nothing can be answered per operation)',
    async (_label, payload) => {
      const { app, headers } = testApp();

      const response = await app.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers,
        payload,
      });

      expect(response.statusCode).toBe(400);
    }
  );

  it('pull rejects a missing body or non-string cursor with 400', async () => {
    const { app, headers } = testApp();

    const missing = await app.inject({ method: 'POST', url: '/api/sync/pull', headers });
    const oversized = await app.inject({
      method: 'POST',
      url: '/api/sync/pull',
      headers,
      payload: { cursor: 'x'.repeat(65) },
    });

    expect([missing.statusCode, oversized.statusCode]).toEqual([400, 400]);
  });

  it('pull rewinds an unrecognized cursor instead of failing', async () => {
    const { app, headers } = testApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/pull',
      headers,
      payload: { cursor: 'someone-elses:7' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ cursor: '0', changes: [], hasMore: true });
  });
});
