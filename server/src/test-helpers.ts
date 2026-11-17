import type { SyncOperationRequest } from '@pokepaper/shared';
import { buildApp, type BuildAppOptions } from './app.js';
import { AuthStore } from './auth/store.js';
import type { AuthConfig } from './config.js';
import { openDatabase, type Db } from './db.js';

export function memoryDb(): Db {
  return openDatabase(':memory:');
}

export const TEST_ORIGIN = 'http://localhost:4200';
export const TEST_SETUP_TOKEN = 'test-setup-token-0123456789';

export function testAuthConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    publicOrigin: TEST_ORIGIN,
    rpId: 'localhost',
    rpName: 'PokePaper',
    sessionTtlDays: 90,
    setupToken: TEST_SETUP_TOKEN,
    setupTokenFile: null,
    rateLimitPerMinute: 1000,
    devBypass: false,
    ...overrides,
  };
}

/**
 * A test app plus `headers` carrying a valid bearer session, for routes that
 * require sign-in.
 */
export function testApp(db: Db = memoryDb(), options: Partial<Omit<BuildAppOptions, 'db'>> = {}) {
  const auth = options.auth ?? testAuthConfig();
  const app = buildApp({ db, logLevel: false, ...options, auth });
  const token = new AuthStore(db, auth.sessionTtlDays).createSession('ios', null);
  return { db, app, headers: { authorization: `Bearer ${token}` } };
}

let opCounter = 0;

export function settingsOp(overrides: Partial<SyncOperationRequest> = {}): SyncOperationRequest {
  opCounter += 1;
  return {
    opId: `op-${String(opCounter)}`,
    entityType: 'settings',
    entityId: 'settings',
    operation: 'upsert',
    payload: { cardLanguage: 'en' },
    clientTimestamp: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
