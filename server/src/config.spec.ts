import { resolve } from 'node:path';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('imports every catalog language on a daily schedule by default', () => {
    expect(loadConfig({}).catalog).toEqual({
      syncEnabled: true,
      languages: ['en', 'fr', 'it', 'de', 'ja', 'zh-tw', 'zh-cn'],
      refreshHours: 24,
      fullRefreshDays: 7,
    });
  });

  it('reads catalog overrides, keeping languages in display order', () => {
    expect(
      loadConfig({
        CATALOG_SYNC_ENABLED: 'false',
        CATALOG_LANGUAGES: ' JA, en ,fr',
        CATALOG_REFRESH_HOURS: '6',
        CATALOG_FULL_REFRESH_DAYS: '30',
      }).catalog
    ).toEqual({
      syncEnabled: false,
      languages: ['en', 'fr', 'ja'],
      refreshHours: 6,
      fullRefreshDays: 30,
    });
  });

  it.each([
    ['CATALOG_REFRESH_HOURS', '169'],
    ['CATALOG_REFRESH_HOURS', '0'],
    ['CATALOG_FULL_REFRESH_DAYS', '366'],
  ])('rejects %s=%s', (key, value) => {
    expect(() => loadConfig({ [key]: value })).toThrow(
      new RegExp(`${key} must be an integer from`)
    );
  });

  it.each(['en,xx', ',', 'english'])('rejects CATALOG_LANGUAGES=%s', (value) => {
    expect(() => loadConfig({ CATALOG_LANGUAGES: value })).toThrow(/CATALOG_LANGUAGES/);
  });

  it('uses defaults when nothing is set', () => {
    const config = loadConfig({});

    expect(config).toMatchObject({
      host: '0.0.0.0',
      port: 3000,
      backupKeep: 14,
      backupIntervalHours: 24,
      trustProxyHops: 0,
      clientIpHeader: null,
      rateLimitPerMinute: 600,
      logLevel: 'info',
    });
    expect(config.dataDir.endsWith(resolve('/server/data'))).toBe(true);
    expect(config.backupDir.endsWith(resolve('/server/backups'))).toBe(true);
  });

  it('reads overrides', () => {
    const config = loadConfig({
      HOST: '127.0.0.1',
      PORT: '8081',
      DATA_DIR: '/data',
      BACKUP_DIR: '/backups',
      BACKUP_KEEP: '3',
      BACKUP_INTERVAL_HOURS: '0',
      TRUST_PROXY_HOPS: '2',
      CLIENT_IP_HEADER: 'CF-Connecting-IP',
      RATE_LIMIT_PER_MINUTE: '30',
      LOG_LEVEL: 'warn',
    });

    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 8081,
      dataDir: '/data',
      backupDir: '/backups',
      backupKeep: 3,
      backupIntervalHours: 0,
      trustProxyHops: 2,
      clientIpHeader: 'cf-connecting-ip',
      rateLimitPerMinute: 30,
      logLevel: 'warn',
    });
  });

  it.each([
    [{ PORT: 'abc' }, /PORT must be an integer/],
    [{ PORT: '0' }, /PORT must be an integer >= 1/],
    [{ BACKUP_KEEP: '0' }, /BACKUP_KEEP/],
    [{ BACKUP_INTERVAL_HOURS: '-1' }, /BACKUP_INTERVAL_HOURS/],
    [{ TRUST_PROXY_HOPS: '-1' }, /TRUST_PROXY_HOPS/],
    [{ TRUST_PROXY_HOPS: 'true' }, /TRUST_PROXY_HOPS must be an integer/],
    [{ CLIENT_IP_HEADER: 'bad header!' }, /CLIENT_IP_HEADER must be a header name/],
    [{ RATE_LIMIT_PER_MINUTE: '0' }, /RATE_LIMIT_PER_MINUTE/],
  ])('fails fast on %o', (env, message) => {
    expect(() => loadConfig(env)).toThrow(message);
  });

  describe('auth', () => {
    it('defaults to local development settings', () => {
      expect(loadConfig({}).auth).toEqual({
        publicOrigin: 'http://localhost:4200',
        rpId: 'localhost',
        rpName: 'PokePaper',
        sessionTtlDays: 90,
        setupToken: null,
        setupTokenFile: null,
        rateLimitPerMinute: 20,
        devBypass: false,
      });
    });

    it('derives the RP ID from the public origin and reads overrides', () => {
      const config = loadConfig({
        NODE_ENV: 'production',
        PUBLIC_ORIGIN: 'https://pokepaper.example.com/',
        SESSION_TTL_DAYS: '30',
        SETUP_TOKEN_FILE: '/run/secrets/setup_token',
        AUTH_RATE_LIMIT_PER_MINUTE: '5',
      });

      expect(config.production).toBe(true);
      expect(config.auth).toMatchObject({
        publicOrigin: 'https://pokepaper.example.com',
        rpId: 'pokepaper.example.com',
        sessionTtlDays: 30,
        setupTokenFile: '/run/secrets/setup_token',
        rateLimitPerMinute: 5,
      });
      expect(
        loadConfig({ PUBLIC_ORIGIN: 'https://a.example.com', RP_ID: 'example.com' }).auth.rpId
      ).toBe('example.com');
    });

    it.each([
      [{ PUBLIC_ORIGIN: 'not a url' }, /must be a URL/],
      [{ PUBLIC_ORIGIN: 'https://pokepaper.example.com/app' }, /without a path/],
      [{ PUBLIC_ORIGIN: 'http://pokepaper.example.com' }, /must use https/],
      [{ NODE_ENV: 'production' }, /must be set to the public https origin/],
      [
        { NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://p.example.com', AUTH_DEV_BYPASS: 'true' },
        /AUTH_DEV_BYPASS cannot be enabled/,
      ],
      [{ AUTH_DEV_BYPASS: 'sure' }, /AUTH_DEV_BYPASS must be true\/false/],
    ])('fails fast on %o', (env, message) => {
      expect(() => loadConfig(env)).toThrow(message);
    });

    it('allows the dev bypass outside production', () => {
      expect(loadConfig({ AUTH_DEV_BYPASS: '1' }).auth.devBypass).toBe(true);
      expect(loadConfig({ AUTH_DEV_BYPASS: '0' }).auth.devBypass).toBe(false);
    });
  });
});
