import { settingsOp, testApp } from '../test-helpers.js';
import { MAX_PUSH_OPERATIONS } from './routes.js';

describe('sync routes', () => {
  it('push applies operations and pull returns them', async () => {
    const { app } = testApp();
    const op = settingsOp({ payload: { cardLanguage: 'ko' } });

    const push = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      payload: { operations: [op] },
    });
    expect(push.statusCode).toBe(200);
    expect(push.json()).toEqual({ results: [{ opId: op.opId, status: 'applied' }] });

    const pull = await app.inject({
      method: 'POST',
      url: '/api/sync/pull',
      payload: { cursor: '0' },
    });
    expect(pull.statusCode).toBe(200);
    expect(pull.json()).toMatchObject({
      cursor: '1',
      hasMore: false,
      changes: [{ entityType: 'settings', payload: { cardLanguage: 'ko' } }],
    });
  });

  it('pull without a cursor starts from the beginning', async () => {
    const { app } = testApp();

    const pull = await app.inject({ method: 'POST', url: '/api/sync/pull', payload: {} });

    expect(pull.statusCode).toBe(200);
    expect(pull.json()).toEqual({ cursor: '0', changes: [], hasMore: false });
  });

  it.each([
    ['a missing operations array', {}],
    ['operations that is not an array', { operations: 'nope' }],
    ['an operation missing fields', { operations: [{ opId: 'x' }] }],
    ['an unknown operation kind', { operations: [settingsOp({ operation: 'patch' as never })] }],
    [
      'too many operations',
      { operations: Array.from({ length: MAX_PUSH_OPERATIONS + 1 }, () => settingsOp()) },
    ],
  ])('push rejects %s with 400', async (_label, payload) => {
    const { app } = testApp();

    const response = await app.inject({ method: 'POST', url: '/api/sync/push', payload });

    expect(response.statusCode).toBe(400);
  });

  it('push strips unknown fields instead of storing them', async () => {
    const { app } = testApp();
    const op = { ...settingsOp(), injected: 'x' };

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      payload: { operations: [op], extra: true },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ results: [{ opId: op.opId, status: 'applied' }] });
  });

  it('pull rejects a missing body with 400', async () => {
    const { app } = testApp();

    const response = await app.inject({ method: 'POST', url: '/api/sync/pull' });

    expect(response.statusCode).toBe(400);
  });

  it.each([['-1'], ['abc'], ['01'], ['12345678901234567']])(
    'pull rejects cursor %s with 400',
    async (cursor) => {
      const { app } = testApp();

      const response = await app.inject({
        method: 'POST',
        url: '/api/sync/pull',
        payload: { cursor },
      });

      expect(response.statusCode).toBe(400);
    }
  );
});
