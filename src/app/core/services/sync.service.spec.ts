import 'fake-indexeddb/auto';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DEFAULT_SETTINGS, SETTINGS_ENTITY_ID, type SyncChange } from '@pokepaper/shared';
import { vi, type MockInstance } from 'vitest';
import { AppDb } from '../data/app-db';
import { DexieStorageEngine } from '../data/dexie-storage-engine';
import { SettingsSyncApplier } from '../data/settings-sync-applier';
import { makeContractOutboxEntry } from '../data/storage-engine.contract';
import { StorageEngineFactory } from '../data/storage-engine.factory';
import { SYNC_ENTITY_APPLIERS } from '../data/sync-entity-applier';
import {
  MAX_PUSH_ATTEMPTS,
  PULL_CURSOR_KEY,
  PUSH_BATCH_SIZE,
  SYNC_ENTITY_TYPES_KEY,
  SyncService,
  type SyncStatus,
} from './sync.service';

vi.mock(
  '../data/storage-transaction-context',
  () => import('../data/storage-transaction-context.node')
);

const PUSH_URL = '/api/sync/push';
const PULL_URL = '/api/sync/pull';

/** Dexie/fake-indexeddb operations resolve via the real event loop, so poll
 * until the request appears. Bounded by time rather than tick count: under
 * full-suite load (and with large outboxes) the number of ticks a sync step
 * needs varies, which made a fixed tick budget flaky. */
const WAIT_TIMEOUT_MS = 3_000;

async function waitForRequest(httpMock: HttpTestingController, url: string) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const matches = httpMock.match(url);
    if (matches.length > 0) {
      return matches[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error(`Timed out waiting for request to ${url}`);
}

async function waitForStatus(service: SyncService, status: SyncStatus) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (service.status() === status) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error(`Timed out waiting for status ${status}`);
}

const EMPTY_PULL = { cursor: '0', changes: [], hasMore: false };

function settingsChange(overrides: Partial<SyncChange> = {}): SyncChange {
  return {
    entityType: 'settings',
    entityId: SETTINGS_ENTITY_ID,
    operation: 'upsert',
    payload: { ...DEFAULT_SETTINGS, cardLanguage: 'ja' },
    serverTimestamp: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('SyncService', () => {
  let db: AppDb;
  let engine: DexieStorageEngine;
  let httpMock: HttpTestingController;
  let syncService: SyncService;
  let onLineSpy: MockInstance<() => boolean>;

  beforeEach(async () => {
    onLineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        AppDb,
        DexieStorageEngine,
        StorageEngineFactory,
        { provide: SYNC_ENTITY_APPLIERS, useClass: SettingsSyncApplier, multi: true },
      ],
    });

    db = TestBed.inject(AppDb);
    engine = TestBed.inject(DexieStorageEngine);
    await TestBed.inject(StorageEngineFactory).initialize();
    httpMock = TestBed.inject(HttpTestingController);
    syncService = TestBed.inject(SyncService);
  });

  afterEach(async () => {
    httpMock.verify();
    onLineSpy.mockRestore();
    await db.delete();
  });

  it('pushes queued outbox entries in order and clears acknowledged ones', async () => {
    await engine.putOutboxEntry(
      makeContractOutboxEntry({
        opId: 'op-2',
        entityId: 'entity-b',
        createdAt: '2026-01-02T00:00:00.000Z',
      })
    );
    await engine.putOutboxEntry(
      makeContractOutboxEntry({
        opId: 'op-1',
        entityId: SETTINGS_ENTITY_ID,
        createdAt: '2026-01-01T00:00:00.000Z',
      })
    );

    const syncPromise = syncService.syncNow();

    const push = await waitForRequest(httpMock, PUSH_URL);
    const operations = (push.request.body as { operations: { opId: string; entityId: string }[] })
      .operations;
    expect(operations.map((op) => op.opId)).toEqual(['op-1', 'op-2']);
    expect(operations[0]?.entityId).toBe(SETTINGS_ENTITY_ID);
    push.flush({
      results: [
        { opId: 'op-1', status: 'applied' },
        { opId: 'op-2', status: 'duplicate' },
      ],
    });

    (await waitForRequest(httpMock, PULL_URL)).flush({ cursor: '0', changes: [], hasMore: false });
    await syncPromise;

    expect(await engine.listOutboxOrderedByCreatedAt()).toEqual([]);
    expect(syncService.status()).toBe('idle');
  });

  it('keeps failed operations queued and records the attempt', async () => {
    await engine.putOutboxEntry(makeContractOutboxEntry({ opId: 'op-1' }));

    const syncPromise = syncService.syncNow();
    (await waitForRequest(httpMock, PUSH_URL)).flush({
      results: [{ opId: 'op-1', status: 'failed', message: 'invalid payload' }],
    });
    (await waitForRequest(httpMock, PULL_URL)).flush({ cursor: '0', changes: [], hasMore: false });
    await syncPromise;

    const [entry] = await engine.listOutboxOrderedByCreatedAt();
    expect(entry.attemptCount).toBe(1);
    expect(entry.lastError).toBe('invalid payload');
    expect(syncService.status()).toBe('error');
  });

  it('pushes only the newest queued operation per entity and drops superseded ones', async () => {
    await engine.putOutboxEntry(
      makeContractOutboxEntry({
        opId: 'old',
        payload: { cardLanguage: 'fr' },
        attemptCount: 2,
        lastError: 'temporary',
        createdAt: '2026-01-01T00:00:00.000Z',
      })
    );
    await engine.putOutboxEntry(
      makeContractOutboxEntry({
        opId: 'new',
        payload: { cardLanguage: 'de' },
        createdAt: '2026-01-02T00:00:00.000Z',
      })
    );

    const syncPromise = syncService.syncNow();
    const push = await waitForRequest(httpMock, PUSH_URL);
    const operations = (push.request.body as { operations: { opId: string }[] }).operations;
    expect(operations.map((op) => op.opId)).toEqual(['new']);
    expect(await engine.getOutboxEntry('old')).toBeUndefined();
    push.flush({ results: [{ opId: 'new', status: 'applied' }] });
    (await waitForRequest(httpMock, PULL_URL)).flush(EMPTY_PULL);
    await syncPromise;

    expect(await engine.listOutboxOrderedByCreatedAt()).toEqual([]);
  });

  it('splits large outboxes into batches', async () => {
    const total = PUSH_BATCH_SIZE + 5;
    for (let index = 0; index < total; index++) {
      await engine.putOutboxEntry(
        makeContractOutboxEntry({
          opId: `op-${String(index).padStart(4, '0')}`,
          entityId: `entity-${String(index)}`,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
        })
      );
    }

    const syncPromise = syncService.syncNow();
    for (const expectedSize of [PUSH_BATCH_SIZE, 5]) {
      const push = await waitForRequest(httpMock, PUSH_URL);
      const operations = (push.request.body as { operations: { opId: string }[] }).operations;
      expect(operations).toHaveLength(expectedSize);
      push.flush({ results: operations.map((op) => ({ opId: op.opId, status: 'applied' })) });
    }
    (await waitForRequest(httpMock, PULL_URL)).flush(EMPTY_PULL);
    await syncPromise;

    expect(await engine.listOutboxOrderedByCreatedAt()).toEqual([]);
  });

  it('drops an operation rejected MAX_PUSH_ATTEMPTS times and re-pulls from cursor 0', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await engine.putSyncMeta({ key: PULL_CURSOR_KEY, value: '42' });
    await engine.putSyncMeta({ key: SYNC_ENTITY_TYPES_KEY, value: 'settings' });
    await engine.putOutboxEntry(
      makeContractOutboxEntry({ opId: 'doomed', attemptCount: MAX_PUSH_ATTEMPTS - 1 })
    );

    const syncPromise = syncService.syncNow();
    (await waitForRequest(httpMock, PUSH_URL)).flush({
      results: [{ opId: 'doomed', status: 'failed', message: 'invalid payload' }],
    });
    const pull = await waitForRequest(httpMock, PULL_URL);
    expect(pull.request.body).toEqual({ cursor: '0' });
    pull.flush({
      cursor: '43',
      changes: [settingsChange({ payload: { cardLanguage: 'en' } })],
      hasMore: false,
    });
    await syncPromise;

    expect(await engine.listOutboxOrderedByCreatedAt()).toEqual([]);
    expect((await engine.getSettings())?.cardLanguage).toBe('en');
    expect(syncService.rejectedOperations()).toBe(1);
    expect(syncService.status()).toBe('idle');
    expect(consoleError).toHaveBeenCalledWith('sync.operation_rejected', expect.anything());
    consoleError.mockRestore();
  });

  it('keeps retryable rejections queued without counting the attempt', async () => {
    await engine.putOutboxEntry(
      makeContractOutboxEntry({ opId: 'future', attemptCount: MAX_PUSH_ATTEMPTS - 1 })
    );

    const syncPromise = syncService.syncNow();
    (await waitForRequest(httpMock, PUSH_URL)).flush({
      results: [
        { opId: 'future', status: 'failed', message: 'Unknown entity type', retryable: true },
      ],
    });
    (await waitForRequest(httpMock, PULL_URL)).flush(EMPTY_PULL);
    await syncPromise;

    const entry = await engine.getOutboxEntry('future');
    expect(entry?.attemptCount).toBe(MAX_PUSH_ATTEMPTS - 1);
    expect(entry?.lastError).toBe('Unknown entity type');
    expect(syncService.rejectedOperations()).toBe(0);
    expect(syncService.status()).toBe('error');
  });

  it('stores and echoes an opaque server cursor verbatim', async () => {
    const first = syncService.syncNow();
    (await waitForRequest(httpMock, PULL_URL)).flush({
      cursor: 'a1b2c3:17',
      changes: [],
      hasMore: false,
    });
    await first;

    const second = syncService.syncNow();
    const pull = await waitForRequest(httpMock, PULL_URL);
    expect(pull.request.body).toEqual({ cursor: 'a1b2c3:17' });
    pull.flush({ cursor: 'a1b2c3:17', changes: [], hasMore: false });
    await second;
  });

  it('does not overwrite an entity that still has a queued local operation', async () => {
    await engine.putSettings({ cardLanguage: 'ja' });
    await engine.putOutboxEntry(
      makeContractOutboxEntry({ opId: 'pending', payload: { cardLanguage: 'ja' } })
    );

    const syncPromise = syncService.syncNow();
    // The push fails transiently (5xx), so the local op stays queued...
    (await waitForRequest(httpMock, PUSH_URL)).flush(null, { status: 503, statusText: 'Busy' });
    await syncPromise;

    // ...and the next cycle pulls older server state for the same entity.
    const retry = syncService.syncNow();
    (await waitForRequest(httpMock, PUSH_URL)).flush({
      results: [{ opId: 'pending', status: 'failed', message: 'temporary' }],
    });
    (await waitForRequest(httpMock, PULL_URL)).flush({
      cursor: '7',
      changes: [settingsChange({ payload: { cardLanguage: 'en' } })],
      hasMore: false,
    });
    await retry;

    expect((await engine.getSettings())?.cardLanguage).toBe('ja');
    expect((await engine.getSyncMeta(PULL_CURSOR_KEY))?.value).toBe('7');
  });

  it('a sync requested mid-cycle runs one more cycle so new writes are pushed promptly', async () => {
    const first = syncService.syncNow();
    const pull = await waitForRequest(httpMock, PULL_URL);

    // A local write lands while the first cycle is already past its push.
    await engine.putOutboxEntry(makeContractOutboxEntry({ opId: 'mid-cycle' }));
    const second = syncService.syncNow();
    expect(second).toBe(first);
    pull.flush(EMPTY_PULL);

    const push = await waitForRequest(httpMock, PUSH_URL);
    push.flush({ results: [{ opId: 'mid-cycle', status: 'applied' }] });
    (await waitForRequest(httpMock, PULL_URL)).flush(EMPTY_PULL);
    await first;

    expect(await engine.listOutboxOrderedByCreatedAt()).toEqual([]);
  });

  it('re-pulls from cursor 0 when the set of entity types with appliers changes', async () => {
    await engine.putSyncMeta({ key: PULL_CURSOR_KEY, value: '99' });
    await engine.putSyncMeta({ key: SYNC_ENTITY_TYPES_KEY, value: '' });

    const syncPromise = syncService.syncNow();
    const pull = await waitForRequest(httpMock, PULL_URL);
    expect(pull.request.body).toEqual({ cursor: '0' });
    pull.flush({ cursor: '100', changes: [], hasMore: false });
    await syncPromise;

    expect((await engine.getSyncMeta(SYNC_ENTITY_TYPES_KEY))?.value).toBe('settings');

    const next = syncService.syncNow();
    const nextPull = await waitForRequest(httpMock, PULL_URL);
    expect(nextPull.request.body).toEqual({ cursor: '100' });
    nextPull.flush({ cursor: '100', changes: [], hasMore: false });
    await next;
  });

  it('announces which entity types a pull changed', async () => {
    const emitted: string[][] = [];
    const subscription = syncService.dataChanged$.subscribe((types) => emitted.push([...types]));

    const syncPromise = syncService.syncNow();
    (await waitForRequest(httpMock, PULL_URL)).flush({
      cursor: '1',
      changes: [settingsChange()],
      hasMore: false,
    });
    await syncPromise;

    const quiet = syncService.syncNow();
    (await waitForRequest(httpMock, PULL_URL)).flush({ cursor: '1', changes: [], hasMore: false });
    await quiet;

    expect(emitted).toEqual([['settings']]);
    subscription.unsubscribe();
  });

  it('skips the push request when the outbox is empty', async () => {
    const syncPromise = syncService.syncNow();

    (await waitForRequest(httpMock, PULL_URL)).flush({ cursor: '0', changes: [], hasMore: false });
    await syncPromise;

    httpMock.expectNone(PUSH_URL);
  });

  it('applies pulled changes through the registered applier and stores the cursor', async () => {
    const syncPromise = syncService.syncNow();

    const pull = await waitForRequest(httpMock, PULL_URL);
    expect(pull.request.body).toEqual({ cursor: '0' });
    pull.flush({ cursor: '5', changes: [settingsChange()], hasMore: false });
    await syncPromise;

    expect((await engine.getSettings())?.cardLanguage).toBe('ja');
    expect((await engine.getSyncMeta(PULL_CURSOR_KEY))?.value).toBe('5');
  });

  it('keeps pulling pages while the server reports more', async () => {
    const syncPromise = syncService.syncNow();

    (await waitForRequest(httpMock, PULL_URL)).flush({
      cursor: '1',
      changes: [settingsChange({ payload: { cardLanguage: 'fr' } })],
      hasMore: true,
    });

    const second = await waitForRequest(httpMock, PULL_URL);
    expect(second.request.body).toEqual({ cursor: '1' });
    second.flush({
      cursor: '2',
      changes: [settingsChange({ payload: { cardLanguage: 'de' } })],
      hasMore: false,
    });
    await syncPromise;

    expect((await engine.getSettings())?.cardLanguage).toBe('de');
    expect((await engine.getSyncMeta(PULL_CURSOR_KEY))?.value).toBe('2');
  });

  it('ignores changes for entity types without an applier but still advances the cursor', async () => {
    const syncPromise = syncService.syncNow();

    (await waitForRequest(httpMock, PULL_URL)).flush({
      cursor: '3',
      changes: [settingsChange({ entityType: 'unknown' as never })],
      hasMore: false,
    });
    await syncPromise;

    expect(await engine.getSettings()).toBeUndefined();
    expect((await engine.getSyncMeta(PULL_CURSOR_KEY))?.value).toBe('3');
  });

  it('resets settings to defaults on a pulled delete', async () => {
    await engine.putSettings({ ...DEFAULT_SETTINGS, cardLanguage: 'ko' });

    const syncPromise = syncService.syncNow();
    (await waitForRequest(httpMock, PULL_URL)).flush({
      cursor: '4',
      changes: [settingsChange({ operation: 'delete', payload: null })],
      hasMore: false,
    });
    await syncPromise;

    expect(await engine.getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('stops syncing on a 401 until resumeAfterReauth, keeping the outbox intact', async () => {
    await engine.putOutboxEntry(makeContractOutboxEntry({ opId: 'op-1' }));

    const syncPromise = syncService.syncNow();
    (await waitForRequest(httpMock, PUSH_URL)).flush(null, {
      status: 401,
      statusText: 'Unauthorized',
    });
    await syncPromise;

    expect(syncService.status()).toBe('unauthorized');
    expect(await engine.listOutboxOrderedByCreatedAt()).toHaveLength(1);

    await syncService.syncNow();
    httpMock.expectNone(PUSH_URL);

    const resumed = syncService.resumeAfterReauth();
    (await waitForRequest(httpMock, PUSH_URL)).flush({
      results: [{ opId: 'op-1', status: 'applied' }],
    });
    (await waitForRequest(httpMock, PULL_URL)).flush({ cursor: '0', changes: [], hasMore: false });
    await resumed;

    expect(syncService.status()).toBe('idle');
    expect(await engine.listOutboxOrderedByCreatedAt()).toEqual([]);
  });

  it('reports error on other failures and retries on the next trigger', async () => {
    const syncPromise = syncService.syncNow();
    (await waitForRequest(httpMock, PULL_URL)).flush(null, {
      status: 500,
      statusText: 'Server Error',
    });
    await syncPromise;

    expect(syncService.status()).toBe('error');

    const retry = syncService.syncNow();
    (await waitForRequest(httpMock, PULL_URL)).flush({ cursor: '0', changes: [], hasMore: false });
    await retry;

    expect(syncService.status()).toBe('idle');
  });

  it('does nothing while offline and reports offline status', async () => {
    onLineSpy.mockReturnValue(false);

    await syncService.syncNow();

    httpMock.expectNone(PULL_URL);
    expect(syncService.status()).toBe('offline');
  });

  it('coalesces concurrent callers into the in-flight cycle plus at most one follow-up', async () => {
    const first = syncService.syncNow();
    const second = syncService.syncNow();
    const third = syncService.syncNow();

    expect(second).toBe(first);
    expect(third).toBe(first);

    (await waitForRequest(httpMock, PULL_URL)).flush(EMPTY_PULL);
    (await waitForRequest(httpMock, PULL_URL)).flush(EMPTY_PULL);
    await first;

    httpMock.expectNone(PULL_URL);
  });

  it('initialize starts one sync and is idempotent', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');

    syncService.initialize();
    syncService.initialize();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    (await waitForRequest(httpMock, PULL_URL)).flush(EMPTY_PULL);
    await waitForStatus(syncService, 'idle');

    window.dispatchEvent(new Event('offline'));
    expect(syncService.status()).toBe('offline');

    const intervalId = setIntervalSpy.mock.results[0]?.value as number;
    window.clearInterval(intervalId);
    setIntervalSpy.mockRestore();
  });
});
