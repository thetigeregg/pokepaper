import type { SyncOperationRequest } from '@pokepaper/shared';
import { buildApp } from './app.js';
import { openDatabase, type Db } from './db.js';

export function memoryDb(): Db {
  return openDatabase(':memory:');
}

export function testApp(db: Db = memoryDb()) {
  return { db, app: buildApp({ db, logLevel: false }) };
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
