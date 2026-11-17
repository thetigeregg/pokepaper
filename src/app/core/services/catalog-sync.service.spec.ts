import 'fake-indexeddb/auto';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CatalogManifest, CatalogSetPack } from '@pokepaper/shared';
import { vi, type MockInstance } from 'vitest';
import { AppDb } from '../data/app-db';
import { DexieStorageEngine } from '../data/dexie-storage-engine';
import { makeContractPack, makeContractSeries } from '../data/storage-engine.contract';
import { StorageEngineFactory } from '../data/storage-engine.factory';
import {
  CATALOG_CHECKED_AT_KEY,
  CATALOG_ETAG_KEY,
  CatalogSyncService,
  type CatalogSyncStatus,
} from './catalog-sync.service';
import { SyncService, type SyncStatus } from './sync.service';

vi.mock(
  '../data/storage-transaction-context',
  () => import('../data/storage-transaction-context.node')
);

const MANIFEST_URL = '/api/catalog/manifest';
const WAIT_TIMEOUT_MS = 3_000;

/** Waits for a request and returns it. `match()` removes what it matches, so it's called once per poll. */
async function waitForRequest(httpMock: HttpTestingController, url: string) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const matches = httpMock.match(url);
    if (matches.length > 0) {
      return matches[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for a request to ${url}`);
}

async function waitFor(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function manifest(packs: CatalogSetPack[], version = 1): CatalogManifest {
  return {
    version,
    languages: ['en'],
    series: [makeContractSeries('intl', 'sv')],
    sets: packs.map((pack) => ({
      region: pack.set.region,
      id: pack.set.id,
      hash: pack.hash,
      cardCount: pack.cards.length,
    })),
  };
}

const SV01 = makeContractPack('intl', 'sv01', ['sv01-001', 'sv01-002']);
const SV02 = makeContractPack('intl', 'sv02', ['sv02-001']);
const SV2A = makeContractPack('asia', 'SV2a', ['SV2a-001']);

describe('CatalogSyncService', () => {
  let db: AppDb;
  let engine: DexieStorageEngine;
  let httpMock: HttpTestingController;
  let service: CatalogSyncService;
  let syncStatus: ReturnType<typeof signal<SyncStatus>>;
  let onLine: MockInstance<() => boolean>;

  beforeEach(() => {
    syncStatus = signal<SyncStatus>('idle');
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        AppDb,
        DexieStorageEngine,
        { provide: SyncService, useValue: { status: syncStatus.asReadonly() } },
        {
          provide: StorageEngineFactory,
          useFactory: (dexie: DexieStorageEngine) => ({ getEngine: () => dexie }),
          deps: [DexieStorageEngine],
        },
      ],
    });
    db = TestBed.inject(AppDb);
    engine = TestBed.inject(DexieStorageEngine);
    httpMock = TestBed.inject(HttpTestingController);
    service = TestBed.inject(CatalogSyncService);
    onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  });

  afterEach(async () => {
    httpMock.verify();
    onLine.mockRestore();
    await db.delete();
  });

  async function respondManifest(body: CatalogManifest, etag: string) {
    const request = await waitForRequest(httpMock, MANIFEST_URL);
    request.flush(body, { headers: { etag } });
    return request;
  }

  async function respondPack(pack: CatalogSetPack) {
    const request = await waitForRequest(
      httpMock,
      `/api/catalog/sets/${pack.set.region}/${pack.set.id}`
    );
    request.flush(pack);
  }

  async function waitForStatus(status: CatalogSyncStatus) {
    await waitFor(() => service.status() === status, `status ${status}`);
  }

  it('downloads every set on the first run and records the manifest', async () => {
    const changes = vi.fn();
    service.changed$.subscribe(changes);

    const run = service.syncNow();
    await respondManifest(manifest([SV01, SV2A]), '"catalog-1"');
    await waitForStatus('downloading');
    expect(service.progress()).toEqual({ done: 0, total: 2 });
    await respondPack(SV01);
    await respondPack(SV2A);
    await run;

    expect(service.status()).toBe('idle');
    expect(service.progress()).toBeNull();
    expect(service.stats()).toEqual({ sets: 2, cards: 3 });
    expect(service.lastChecked()).toBeInstanceOf(Date);
    expect(changes).toHaveBeenCalledTimes(2);
    expect((await engine.listCatalogCards('intl', 'sv01')).map((card) => card.id)).toEqual([
      'sv01-001',
      'sv01-002',
    ]);
    expect(await engine.listCatalogSeries()).toEqual([makeContractSeries('intl', 'sv')]);
    expect((await engine.getSyncMeta(CATALOG_ETAG_KEY))?.value).toBe('"catalog-1"');
    expect(await engine.getSyncMeta(CATALOG_CHECKED_AT_KEY)).toBeDefined();
  });

  it('asks with the last ETag and downloads nothing when the catalog is unchanged', async () => {
    await engine.putSyncMeta({ key: CATALOG_ETAG_KEY, value: '"catalog-1"' });

    const run = service.syncNow();
    const request = await waitForRequest(httpMock, MANIFEST_URL);
    expect(request.request.headers.get('If-None-Match')).toBe('"catalog-1"');
    request.flush(null, { status: 304, statusText: 'Not Modified' });
    await run;

    expect(service.status()).toBe('idle');
    expect(service.lastChecked()).toBeInstanceOf(Date);
  });

  it('downloads only changed sets and removes dropped ones', async () => {
    await engine.replaceCatalogSet(SV01);
    await engine.replaceCatalogSet(SV02);
    const updated = makeContractPack('intl', 'sv01', ['sv01-001'], 'hash-sv01-v2');

    const run = service.syncNow();
    await respondManifest(manifest([updated, SV2A], 2), '"catalog-2"');
    await respondPack(updated);
    await respondPack(SV2A);
    await run;

    expect((await engine.listCatalogSets()).map((set) => `${set.key}@${set.hash}`).sort()).toEqual([
      'asia:SV2a@hash-SV2a',
      'intl:sv01@hash-sv01-v2',
    ]);
    httpMock.expectNone('/api/catalog/sets/intl/sv02');
  });

  it('waits out rate limiting instead of failing the download', async () => {
    const sleep = vi.spyOn(service as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep');
    sleep.mockResolvedValue(undefined);

    const run = service.syncNow();
    await respondManifest(manifest([SV01]), '"catalog-1"');
    (await waitForRequest(httpMock, '/api/catalog/sets/intl/sv01')).flush(null, {
      status: 429,
      statusText: 'Too Many Requests',
      headers: { 'retry-after': '7' },
    });
    await respondPack(SV01);
    await run;

    expect(sleep).toHaveBeenCalledWith(7000);
    expect(service.status()).toBe('idle');
    expect(service.stats()).toEqual({ sets: 1, cards: 2 });
  });

  it('gives up on a pack after repeated failures', async () => {
    vi.spyOn(
      service as unknown as { sleep: (ms: number) => Promise<void> },
      'sleep'
    ).mockResolvedValue(undefined);

    const run = service.syncNow();
    await respondManifest(manifest([SV01]), '"catalog-1"');
    for (let attempt = 0; attempt < 4; attempt++) {
      (await waitForRequest(httpMock, '/api/catalog/sets/intl/sv01')).flush(null, {
        status: 503,
        statusText: 'Unavailable',
      });
    }
    await run;

    expect(service.status()).toBe('error');
  });

  it('resumes an interrupted download with only the missing sets', async () => {
    const first = service.syncNow();
    await respondManifest(manifest([SV01, SV2A]), '"catalog-1"');
    await respondPack(SV01);
    // A set removed between the manifest and its download: not retried.
    (await waitForRequest(httpMock, '/api/catalog/sets/asia/SV2a')).flush('gone', {
      status: 404,
      statusText: 'Not Found',
    });
    await first;

    expect(service.status()).toBe('error');
    expect(await engine.getSyncMeta(CATALOG_ETAG_KEY)).toBeUndefined();

    const second = service.syncNow();
    const request = await respondManifest(manifest([SV01, SV2A]), '"catalog-1"');
    expect(request.request.headers.has('If-None-Match')).toBe(false);
    await respondPack(SV2A);
    await second;

    expect(service.stats()).toEqual({ sets: 2, cards: 3 });
    expect((await engine.getSyncMeta(CATALOG_ETAG_KEY))?.value).toBe('"catalog-1"');
  });

  it('does nothing while signed out, and checks right after signing in', async () => {
    service.initialize();
    await respondManifest(manifest([]), '"catalog-0"');
    await waitForStatus('idle');

    syncStatus.set('unauthorized');
    TestBed.tick();
    expect(service.status()).toBe('unauthorized');
    await service.syncNow();
    httpMock.expectNone(MANIFEST_URL);

    syncStatus.set('idle');
    TestBed.tick();
    await respondManifest(manifest([]), '"catalog-0"');
    await waitForStatus('idle');
  });

  it('stops a download overtaken by a sign-out', async () => {
    service.initialize();
    await respondManifest(manifest([SV01, SV02, SV2A]), '"catalog-1"');
    await respondPack(SV01);

    syncStatus.set('unauthorized');
    TestBed.tick();
    for (const request of httpMock.match(() => true)) {
      request.flush(request.request.url.includes('sv02') ? SV02 : SV2A);
    }
    await waitFor(() => service.progress() === null, 'run to stop');

    expect(service.status()).toBe('unauthorized');
    expect(await engine.getSyncMeta(CATALOG_ETAG_KEY)).toBeUndefined();
    expect((await engine.listCatalogSets()).length).toBeLessThan(3);
  });

  it('reports a rejected session as unauthorized', async () => {
    const run = service.syncNow();
    (await waitForRequest(httpMock, MANIFEST_URL)).flush(null, {
      status: 401,
      statusText: 'Unauthorized',
    });
    await run;

    expect(service.status()).toBe('unauthorized');
  });

  it('reports offline without making a request', async () => {
    onLine.mockReturnValue(false);

    await service.syncNow();

    expect(service.status()).toBe('offline');
    httpMock.expectNone(MANIFEST_URL);
  });

  it('runs once more when asked during a run', async () => {
    const first = service.syncNow();
    const again = service.syncNow();
    expect(again).toBe(first);

    await respondManifest(manifest([]), '"catalog-0"');
    (await waitForRequest(httpMock, MANIFEST_URL)).flush(null, {
      status: 304,
      statusText: 'Not Modified',
    });
    await first;

    expect(service.status()).toBe('idle');
  });
});
