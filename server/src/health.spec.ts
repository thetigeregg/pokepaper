import { testApp } from './test-helpers.js';

describe('GET /api/health', () => {
  it('is ok while the database answers', async () => {
    const { app } = testApp();

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('returns 503 when the database becomes unavailable after startup', async () => {
    const { app, db } = testApp();
    await app.ready();
    db.close();

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'unavailable' });
  });
});
