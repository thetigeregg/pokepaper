import { buildApp } from './app.js';
import { memoryDb, testAuthConfig } from './test-helpers.js';

const PROXY = '172.18.0.2';

function viaProxy(headers: Record<string, string>) {
  return { method: 'GET' as const, url: '/api/health', remoteAddress: PROXY, headers };
}

describe('buildApp rate limiting', () => {
  it('limits requests per client IP across routes', async () => {
    const app = buildApp({
      db: memoryDb(),
      auth: testAuthConfig(),
      logLevel: false,
      rateLimitPerMinute: 2,
    });

    const statuses: number[] = [];
    for (let index = 0; index < 3; index++) {
      statuses.push((await app.inject({ method: 'GET', url: '/api/health' })).statusCode);
    }
    const pull = await app.inject({ method: 'POST', url: '/api/sync/pull', payload: {} });

    expect(statuses).toEqual([200, 200, 429]);
    expect(pull.statusCode).toBe(429);
  });

  it('counts each client IP separately', async () => {
    const app = buildApp({
      db: memoryDb(),
      auth: testAuthConfig(),
      logLevel: false,
      rateLimitPerMinute: 1,
    });

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

  it('keys on the configured client-IP header, which a client cannot rotate', async () => {
    const app = buildApp({
      db: memoryDb(),
      auth: testAuthConfig(),
      logLevel: false,
      clientIpHeader: 'cf-connecting-ip',
      rateLimitPerMinute: 1,
    });

    // Same real client (as set by Cloudflare) rotating spoofed X-Forwarded-For values.
    const first = await app.inject(
      viaProxy({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.1.1.1' })
    );
    const second = await app.inject(
      viaProxy({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '2.2.2.2' })
    );
    const otherClient = await app.inject(viaProxy({ 'cf-connecting-ip': '203.0.113.8' }));

    expect([first.statusCode, second.statusCode, otherClient.statusCode]).toEqual([200, 429, 200]);
  });

  it('keys IPv6 clients per /64 prefix, whatever the textual form', async () => {
    const app = buildApp({
      db: memoryDb(),
      auth: testAuthConfig(),
      logLevel: false,
      clientIpHeader: 'cf-connecting-ip',
      rateLimitPerMinute: 1,
    });

    await app.inject(viaProxy({ 'cf-connecting-ip': '2001:db8:1:2::1' }));
    const rotatedInPrefix = await app.inject(
      viaProxy({ 'cf-connecting-ip': '2001:db8:1:2:ffff:ffff:ffff:ffff' })
    );
    const expandedForm = await app.inject(
      viaProxy({ 'cf-connecting-ip': '2001:0DB8:0001:0002:0000:0000:0000:0001' })
    );
    const otherPrefix = await app.inject(viaProxy({ 'cf-connecting-ip': '2001:db8:1:3::1' }));

    expect([rotatedInPrefix.statusCode, expandedForm.statusCode, otherPrefix.statusCode]).toEqual([
      429, 429, 200,
    ]);
  });

  it('ignores X-Forwarded-For entirely with zero trusted hops', async () => {
    const app = buildApp({
      db: memoryDb(),
      auth: testAuthConfig(),
      logLevel: false,
      rateLimitPerMinute: 1,
    });

    await app.inject(viaProxy({ 'x-forwarded-for': '1.1.1.1' }));
    const spoofed = await app.inject(viaProxy({ 'x-forwarded-for': '2.2.2.2' }));

    expect(spoofed.statusCode).toBe(429);
  });

  it('with N trusted hops, only the Nth-from-nearest forwarded address counts', async () => {
    const app = buildApp({
      db: memoryDb(),
      auth: testAuthConfig(),
      logLevel: false,
      trustProxyHops: 1,
      rateLimitPerMinute: 1,
    });

    // One trusted proxy appends the real client (203.0.113.9) after whatever
    // the client claimed; rotating the claimed prefix must not help.
    await app.inject(viaProxy({ 'x-forwarded-for': '1.1.1.1, 203.0.113.9' }));
    const rotated = await app.inject(viaProxy({ 'x-forwarded-for': '2.2.2.2, 203.0.113.9' }));
    const otherClient = await app.inject(viaProxy({ 'x-forwarded-for': '1.1.1.1, 203.0.113.10' }));

    expect([rotated.statusCode, otherClient.statusCode]).toEqual([429, 200]);
  });

  it('falls back to the socket address when the client-IP header is missing or oversized', async () => {
    const app = buildApp({
      db: memoryDb(),
      auth: testAuthConfig(),
      logLevel: false,
      clientIpHeader: 'cf-connecting-ip',
      rateLimitPerMinute: 1,
    });

    await app.inject(viaProxy({}));
    const oversized = await app.inject(viaProxy({ 'cf-connecting-ip': 'x'.repeat(100) }));

    expect(oversized.statusCode).toBe(429);
  });
});
