import 'fake-indexeddb/auto';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  CatalogManifest,
  CatalogPricePack,
  CatalogRegion,
  CatalogSetPack,
} from '@pokepaper/shared';
import { vi, type MockInstance } from 'vitest';
import { AppDb } from '../data/app-db';
import { DexieStorageEngine } from '../data/dexie-storage-engine';
import {
  makeContractPack,
  makeContractPricePack,
  makeContractPrices,
  makeContractSeries,
} from '../data/storage-engine.contract';
import { StorageEngineFactory } from '../data/storage-engine.factory';
import {
  CATALOG_CHECKED_AT_KEY,
  CATALOG_ETAG_KEY,
  catalogPricesEtagKey,
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
  const syncNow = vi.fn(() => Promise.resolve());
  let onLine: MockInstance<() => boolean>;

  beforeEach(() => {
    syncStatus = signal<SyncStatus>('idle');
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        AppDb,
        DexieStorageEngine,
        { provide: SyncService, useValue: { status: syncStatus.asReadonly(), syncNow } },
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
    syncNow.mockClear();
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

  /** Answers a region's price request with a pack, or 304 when `pack` is null. */
  async function respondPrices(
    region: CatalogRegion,
    pack: CatalogPricePack | null = null,
    etag = `"prices-${region}-1"`
  ) {
    const request = await waitForRequest(httpMock, `/api/catalog/prices/${region}`);
    if (pack) {
      request.flush(pack, { headers: { etag } });
    } else {
      request.flush(null, { status: 304, statusText: 'Not Modified' });
    }
    return request;
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
    await respondPrices('intl', makeContractPricePack('intl', { 'sv01-001': 0.14 }));
    await respondPrices('asia', makeContractPricePack('asia', {}));
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
    await respondPrices('intl');
    await respondPrices('asia');
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
    await respondPrices('intl');
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
    // A failure retrying won't fix.
    (await waitForRequest(httpMock, '/api/catalog/sets/asia/SV2a')).flush('bad', {
      status: 400,
      statusText: 'Bad Request',
    });
    await first;

    expect(service.status()).toBe('error');
    expect(await engine.getSyncMeta(CATALOG_ETAG_KEY)).toBeUndefined();

    const second = service.syncNow();
    const request = await respondManifest(manifest([SV01, SV2A]), '"catalog-1"');
    expect(request.request.headers.has('If-None-Match')).toBe(false);
    await respondPack(SV2A);
    await respondPrices('intl');
    await respondPrices('asia');
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

  it('reports a rejected session as unauthorized and asks SyncService to confirm it', async () => {
    const run = service.syncNow();
    (await waitForRequest(httpMock, MANIFEST_URL)).flush(null, {
      status: 401,
      statusText: 'Unauthorized',
    });
    await run;

    expect(service.status()).toBe('unauthorized');
    expect(syncNow).toHaveBeenCalled();
  });

  it('skips a set removed on the server after the manifest, and finishes the rest', async () => {
    await engine.replaceCatalogSet(makeContractPack('asia', 'SV2a', ['SV2a-001'], 'old-hash'));

    const run = service.syncNow();
    await respondManifest(manifest([SV01, SV2A]), '"catalog-1"');
    await respondPack(SV01);
    (await waitForRequest(httpMock, '/api/catalog/sets/asia/SV2a')).flush('gone', {
      status: 404,
      statusText: 'Not Found',
    });
    await respondPrices('intl');
    await run;

    expect(service.status()).toBe('idle');
    expect((await engine.listCatalogSets()).map((set) => set.key)).toEqual(['intl:sv01']);
    // No sets left in that catalog, so no prices either.
    httpMock.expectNone('/api/catalog/prices/asia');
  });

  it('stops before its next request as soon as SyncService is signed out', async () => {
    const run = service.syncNow();
    await respondManifest(manifest([SV01, SV02]), '"catalog-1"');
    // Signed out synchronously; the relaying effect hasn't run (no TestBed.tick()).
    syncStatus.set('unauthorized');
    for (const request of httpMock.match(() => true)) {
      request.flush(request.request.url.includes('sv01') ? SV01 : SV02);
    }
    await run;

    expect(service.status()).toBe('unauthorized');
    httpMock.expectNone(() => true);
    expect(await engine.getSyncMeta(CATALOG_ETAG_KEY)).toBeUndefined();
  });

  it('keeps a sign-out that lands as a run finishes, and does not run again', async () => {
    const run = service.syncNow();
    const request = await waitForRequest(httpMock, MANIFEST_URL);
    void service.syncNow(); // Asks for a rerun.
    request.flush(null, { status: 304, statusText: 'Not Modified' });
    syncStatus.set('unauthorized');
    TestBed.tick();
    await run;

    expect(service.status()).toBe('unauthorized');
    httpMock.expectNone(MANIFEST_URL);
  });

  it('asks the browser to keep its storage once a catalog is stored', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    const persisted = vi.fn(() => Promise.resolve(false));
    Object.defineProperty(navigator, 'storage', {
      value: { persist, persisted },
      configurable: true,
    });
    await engine.replaceCatalogSet(SV01);

    const run = service.syncNow();
    (await waitForRequest(httpMock, MANIFEST_URL)).flush(null, {
      status: 304,
      statusText: 'Not Modified',
    });
    await respondPrices('intl');
    await run;

    expect(persist).toHaveBeenCalledTimes(1);
    Reflect.deleteProperty(navigator, 'storage');
  });

  describe('prices', () => {
    it('stores each catalog’s prices after its sets, and asks with their ETag next time', async () => {
      const first = service.syncNow();
      await respondManifest(manifest([SV01, SV2A]), '"catalog-1"');
      await respondPack(SV01);
      await respondPack(SV2A);
      const intl = await respondPrices(
        'intl',
        makeContractPricePack('intl', { 'sv01-001': 0.14 }),
        '"prices-intl-4"'
      );
      await respondPrices('asia', makeContractPricePack('asia', { 'SV2a-001': 8.33 }));
      await first;

      expect(intl.request.headers.has('If-None-Match')).toBe(false);
      expect(await engine.getCatalogCardPrices('intl', 'sv01-001')).toEqual(
        makeContractPrices(0.14)
      );
      expect((await engine.getCatalogCardPrices('asia', 'SV2a-001'))?.base?.trend).toBe(8.33);
      expect((await engine.getSyncMeta(catalogPricesEtagKey('intl')))?.value).toBe(
        '"prices-intl-4"'
      );

      const second = service.syncNow();
      (await waitForRequest(httpMock, MANIFEST_URL)).flush(null, {
        status: 304,
        statusText: 'Not Modified',
      });
      const again = await respondPrices('intl');
      await respondPrices('asia', makeContractPricePack('asia', {}, 2), '"prices-asia-2"');
      await second;

      expect(again.request.headers.get('If-None-Match')).toBe('"prices-intl-4"');
      expect((await engine.getCatalogCardPrices('intl', 'sv01-001'))?.base?.trend).toBe(0.14);
      expect(await engine.getCatalogCardPrices('asia', 'SV2a-001')).toBeUndefined();
      expect(service.status()).toBe('idle');
    });

    it('carries on without prices when the server has none (404)', async () => {
      await engine.replaceCatalogSet(SV01);

      const run = service.syncNow();
      (await waitForRequest(httpMock, MANIFEST_URL)).flush(null, {
        status: 304,
        statusText: 'Not Modified',
      });
      (await waitForRequest(httpMock, '/api/catalog/prices/intl')).flush('not found', {
        status: 404,
        statusText: 'Not Found',
      });
      await run;

      expect(service.status()).toBe('idle');
      expect(await engine.getSyncMeta(catalogPricesEtagKey('intl'))).toBeUndefined();
    });

    it('waits out brief failures, and reports an error when they persist', async () => {
      vi.spyOn(
        service as unknown as { sleep: (ms: number) => Promise<void> },
        'sleep'
      ).mockResolvedValue(undefined);
      await engine.replaceCatalogSet(SV01);

      const run = service.syncNow();
      (await waitForRequest(httpMock, MANIFEST_URL)).flush(null, {
        status: 304,
        statusText: 'Not Modified',
      });
      (await waitForRequest(httpMock, '/api/catalog/prices/intl')).flush(null, {
        status: 503,
        statusText: 'Unavailable',
      });
      await respondPrices('intl', makeContractPricePack('intl', { 'sv01-001': 0.14 }));
      await run;
      expect(service.status()).toBe('idle');
      expect((await engine.getCatalogCardPrices('intl', 'sv01-001'))?.base?.trend).toBe(0.14);

      const failing = service.syncNow();
      (await waitForRequest(httpMock, MANIFEST_URL)).flush(null, {
        status: 304,
        statusText: 'Not Modified',
      });
      for (let attempt = 0; attempt < 4; attempt++) {
        (await waitForRequest(httpMock, '/api/catalog/prices/intl')).flush(null, {
          status: 503,
          statusText: 'Unavailable',
        });
      }
      await failing;
      expect(service.status()).toBe('error');
      // The prices already on the device stay.
      expect((await engine.getCatalogCardPrices('intl', 'sv01-001'))?.base?.trend).toBe(0.14);
    });

    it('stores no prices once a sign-out overtakes the run', async () => {
      await engine.replaceCatalogSet(SV01);

      const run = service.syncNow();
      (await waitForRequest(httpMock, MANIFEST_URL)).flush(null, {
        status: 304,
        statusText: 'Not Modified',
      });
      const request = await waitForRequest(httpMock, '/api/catalog/prices/intl');
      syncStatus.set('unauthorized');
      request.flush(makeContractPricePack('intl', { 'sv01-001': 0.14 }), {
        headers: { etag: '"prices-intl-1"' },
      });
      await run;

      expect(service.status()).toBe('unauthorized');
      expect(await engine.getCatalogCardPrices('intl', 'sv01-001')).toBeUndefined();
    });
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
