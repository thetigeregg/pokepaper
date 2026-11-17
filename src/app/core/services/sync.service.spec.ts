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
import { PULL_CURSOR_KEY, SyncService } from './sync.service';

vi.mock(
  '../data/storage-transaction-context',
  () => import('../data/storage-transaction-context.node')
);

const PUSH_URL = '/api/sync/push';
const PULL_URL = '/api/sync/pull';

/** Dexie/fake-indexeddb operations resolve via the real event loop, so poll
 * until the request appears instead of guessing a fixed number of ticks
 * (same helper as go-gather's sync spec). */
async function waitForRequest(httpMock: HttpTestingController, url: string) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const matches = httpMock.match(url);
    if (matches.length > 0) {
      return matches[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error(`Timed out waiting for request to ${url}`);
}

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
      makeContractOutboxEntry({ opId: 'op-2', createdAt: '2026-01-02T00:00:00.000Z' })
    );
    await engine.putOutboxEntry(
      makeContractOutboxEntry({ opId: 'op-1', createdAt: '2026-01-01T00:00:00.000Z' })
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

  it('shares one in-flight cycle between concurrent callers', async () => {
    const first = syncService.syncNow();
    const second = syncService.syncNow();

    expect(second).toBe(first);

    (await waitForRequest(httpMock, PULL_URL)).flush({ cursor: '0', changes: [], hasMore: false });
    await Promise.all([first, second]);
  });

  it('enqueueOperation stores an outbox entry and triggers a sync', async () => {
    const enqueued = syncService.enqueueOperation({
      entityType: 'settings',
      entityId: SETTINGS_ENTITY_ID,
      operation: 'upsert',
      payload: { ...DEFAULT_SETTINGS },
    });
    await enqueued;

    const push = await waitForRequest(httpMock, PUSH_URL);
    const [operation] = (push.request.body as { operations: { opId: string }[] }).operations;
    push.flush({ results: [{ opId: operation.opId, status: 'applied' }] });
    (await waitForRequest(httpMock, PULL_URL)).flush({ cursor: '0', changes: [], hasMore: false });
    await syncService.syncNow();

    expect(await engine.listOutboxOrderedByCreatedAt()).toEqual([]);
  });

  it('initialize starts one sync and is idempotent', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');

    syncService.initialize();
    syncService.initialize();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    (await waitForRequest(httpMock, PULL_URL)).flush({ cursor: '0', changes: [], hasMore: false });
    await syncService.syncNow();

    window.dispatchEvent(new Event('offline'));
    expect(syncService.status()).toBe('offline');

    const intervalId = setIntervalSpy.mock.results[0]?.value as number;
    window.clearInterval(intervalId);
    setIntervalSpy.mockRestore();
  });
});
