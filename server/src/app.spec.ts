import { buildApp } from './app.js';
import { memoryDb } from './test-helpers.js';

describe('buildApp rate limiting', () => {
  it('limits requests per client IP across routes', async () => {
    const app = buildApp({ db: memoryDb(), logLevel: false, rateLimitPerMinute: 2 });

    const statuses: number[] = [];
    for (let index = 0; index < 3; index++) {
      statuses.push((await app.inject({ method: 'GET', url: '/api/health' })).statusCode);
    }
    const pull = await app.inject({ method: 'POST', url: '/api/sync/pull', payload: {} });

    expect(statuses).toEqual([200, 200, 429]);
    expect(pull.statusCode).toBe(429);
  });

  it('counts each client IP separately', async () => {
    const app = buildApp({ db: memoryDb(), logLevel: false, rateLimitPerMinute: 1 });

    const first = await app.inject({
      method: 'GET',
      url: '/api/health',
      remoteAddress: '10.0.0.1',
    });
    const second = await app.inject({
      method: 'GET',
      url: '/api/health',
      remoteAddress: '10.0.0.2',
    });

    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
  });

  it('uses the forwarded client IP only when trustProxy is on', async () => {
    const trusted = buildApp({
      db: memoryDb(),
      logLevel: false,
      trustProxy: true,
      rateLimitPerMinute: 1,
    });
    const untrusted = buildApp({ db: memoryDb(), logLevel: false, rateLimitPerMinute: 1 });
    const fromClient = (ip: string) => ({
      method: 'GET' as const,
      url: '/api/health',
      remoteAddress: '172.18.0.2',
      headers: { 'x-forwarded-for': ip },
    });

    await trusted.inject(fromClient('203.0.113.1'));
    await untrusted.inject(fromClient('203.0.113.1'));

    expect((await trusted.inject(fromClient('203.0.113.2'))).statusCode).toBe(200);
    expect((await untrusted.inject(fromClient('203.0.113.2'))).statusCode).toBe(429);
  });
});
