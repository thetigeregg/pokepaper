import { memoryDb, testApp, testAuthConfig } from './test-helpers.js';
import { buildApp } from './app.js';

describe('GET /api/health', () => {
  it('is ok while the database answers, and reports the caller as rate-limited', async () => {
    const { app } = testApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      remoteAddress: '10.0.0.7',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', clientIp: '10.0.0.7' });
  });

  it('reports the configured client-IP header when present', async () => {
    const app = buildApp({
      db: memoryDb(),
      auth: testAuthConfig(),
      logLevel: false,
      clientIpHeader: 'cf-connecting-ip',
    });

    const viaHeader = await app.inject({
      method: 'GET',
      url: '/api/health',
      remoteAddress: '172.18.0.2',
      headers: { 'cf-connecting-ip': '203.0.113.9' },
    });
    const withoutHeader = await app.inject({
      method: 'GET',
      url: '/api/health',
      remoteAddress: '172.18.0.2',
    });

    expect(viaHeader.json()).toEqual({ status: 'ok', clientIp: '203.0.113.9' });
    expect(withoutHeader.json()).toEqual({ status: 'ok', clientIp: '172.18.0.2' });
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
