import { resolve } from 'node:path';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('uses defaults when nothing is set', () => {
    const config = loadConfig({});

    expect(config).toMatchObject({
      host: '0.0.0.0',
      port: 3000,
      backupKeep: 14,
      backupIntervalHours: 24,
      trustProxy: false,
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
      TRUST_PROXY: 'true',
      LOG_LEVEL: 'warn',
    });

    expect(config).toEqual({
      host: '127.0.0.1',
      port: 8081,
      dataDir: '/data',
      backupDir: '/backups',
      backupKeep: 3,
      backupIntervalHours: 0,
      trustProxy: true,
      logLevel: 'warn',
    });
  });

  it.each([
    [{ PORT: 'abc' }, /PORT must be an integer/],
    [{ PORT: '0' }, /PORT must be an integer >= 1/],
    [{ BACKUP_KEEP: '0' }, /BACKUP_KEEP/],
    [{ BACKUP_INTERVAL_HOURS: '-1' }, /BACKUP_INTERVAL_HOURS/],
    [{ TRUST_PROXY: 'yes' }, /TRUST_PROXY must be true\/false/],
  ])('fails fast on %o', (env, message) => {
    expect(() => loadConfig(env)).toThrow(message);
  });

  it('accepts 1/0 for booleans', () => {
    expect(loadConfig({ TRUST_PROXY: '1' }).trustProxy).toBe(true);
    expect(loadConfig({ TRUST_PROXY: '0' }).trustProxy).toBe(false);
  });
});
