import 'fake-indexeddb/auto';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AppDb } from '../data/app-db';
import { DexieStorageEngine } from '../data/dexie-storage-engine';
import { makeContractImageCacheRecord } from '../data/storage-engine.contract';
import { StorageEngineFactory } from '../data/storage-engine.factory';
import { PreferenceStorageService } from '../storage/preference-storage.service';
import { IMAGE_CACHE_LIMIT_KEY, ImageCacheService } from './image-cache.service';

vi.mock(
  '../data/storage-transaction-context',
  () => import('../data/storage-transaction-context.node')
);

const URL_A = '/images/catalog/cards/intl/sv01-001/en/low.webp';
const URL_B = '/images/catalog/cards/intl/sv01-002/en/low.webp';
const MB = 1024 * 1024;

async function waitForRequest(httpMock: HttpTestingController, url: string) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const matches = httpMock.match(url);
    if (matches.length > 0) {
      return matches[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

describe('ImageCacheService', () => {
  let db: AppDb;
  let engine: DexieStorageEngine;
  let httpMock: HttpTestingController;
  let service: ImageCacheService;
  const preferences = new Map<string, string>();
  let revoke: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    preferences.clear();
    let next = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test-${String(next++)}`);
    revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        AppDb,
        DexieStorageEngine,
        {
          provide: StorageEngineFactory,
          useFactory: (dexie: DexieStorageEngine) => ({ getEngine: () => dexie }),
          deps: [DexieStorageEngine],
        },
        {
          provide: PreferenceStorageService,
          useValue: {
            getItem: (key: string) => Promise.resolve(preferences.get(key) ?? null),
            setItem: (key: string, value: string) => {
              preferences.set(key, value);
              return Promise.resolve();
            },
          },
        },
      ],
    });
    db = TestBed.inject(AppDb);
    engine = TestBed.inject(DexieStorageEngine);
    httpMock = TestBed.inject(HttpTestingController);
    service = TestBed.inject(ImageCacheService);
  });

  afterEach(async () => {
    httpMock.verify();
    vi.restoreAllMocks();
    await db.delete();
  });

  it('downloads an image once, then serves it from the device', async () => {
    const first = service.resolve(URL_A);
    (await waitForRequest(httpMock, URL_A)).flush(new Blob(['abc'], { type: 'image/webp' }));

    expect(await first).toBe('blob:test-0');
    expect(await service.resolve(URL_A)).toBe('blob:test-0');
    httpMock.expectNone(URL_A);
    expect((await engine.getImage(URL_A))?.size).toBe(3);
  });

  it('keeps an object URL until everything showing it has released it', async () => {
    await engine.putImage(makeContractImageCacheRecord({ key: 'a', blob: new Blob(['x']) }));

    expect(await service.resolve('a')).toBe('blob:test-0');
    expect(await service.resolve('a')).toBe('blob:test-0'); // A second display shares it.
    service.release('a');
    expect(revoke).not.toHaveBeenCalled();
    service.release('a');
    expect(revoke).toHaveBeenCalledWith('blob:test-0');
    service.release('a'); // Extra releases are ignored.
    expect(await service.resolve('a')).toBe('blob:test-1');
  });

  it('shares one download between concurrent requests', async () => {
    const both = Promise.all([service.resolve(URL_A), service.resolve(URL_A)]);
    (await waitForRequest(httpMock, URL_A)).flush(new Blob(['abc']));

    expect(await both).toEqual(['blob:test-0', 'blob:test-0']);
  });

  it('downloads again, pinned, if eviction took a joined download before its pin', async () => {
    const viewing = service.resolve(URL_A);
    const first = await waitForRequest(httpMock, URL_A); // The unpinned download is in flight.
    const pinning = service.store(URL_A, 'intl:sv01'); // Joins it.
    const pinImages = engine.pinImages.bind(engine);
    vi.spyOn(engine, 'pinImages').mockImplementationOnce(async (setKey, keys) => {
      await engine.deleteImage(URL_A); // Evicted just before the pin lands.
      return pinImages(setKey, keys);
    });
    first.flush(new Blob(['abc']));
    (await waitForRequest(httpMock, URL_A)).flush(new Blob(['abc']));

    expect(await pinning).toBe('downloaded');
    await viewing;
    expect(await engine.getImage(URL_A)).toBeDefined();
    expect(await engine.listPinnedSets()).toEqual([{ setKey: 'intl:sv01', images: 1, bytes: 3 }]);
  });

  it('returns null for an image the server lacks, and does not ask again', async () => {
    const first = service.resolve(URL_A);
    (await waitForRequest(httpMock, URL_A)).flush(null, { status: 404, statusText: 'Not Found' });

    expect(await first).toBeNull();
    expect(await service.resolve(URL_A)).toBeNull();
    httpMock.expectNone(URL_A);
  });

  it('pins an image for a downloaded set, already cached or not', async () => {
    const stored = service.store(URL_A, 'intl:sv01');
    (await waitForRequest(httpMock, URL_A)).flush(new Blob(['abcd']));
    expect(await stored).toBe('downloaded');

    expect(await service.store(URL_A, 'intl:sv02')).toBe('cached');
    expect(await engine.listPinnedSets()).toEqual([
      { setKey: 'intl:sv01', images: 1, bytes: 4 },
      { setKey: 'intl:sv02', images: 1, bytes: 4 },
    ]);
  });

  it('evicts the least recently viewed unpinned images past the limit', async () => {
    const put = (key: string, size: number, day: number) =>
      engine.putImage(
        makeContractImageCacheRecord({
          key,
          size,
          blob: new Blob(['x']),
          lastAccessedAt: `2026-01-0${String(day)}T00:00:00.000Z`,
        })
      );
    await put('old', 0.4 * MB, 1);
    await put('pinned', 5 * MB, 2);
    await put('mid', 0.4 * MB, 3);
    await put('new', 0.4 * MB, 4);
    await engine.pinImages('intl:sv01', ['pinned']);

    await service.setLimitMb(1);

    expect(preferences.get(IMAGE_CACHE_LIMIT_KEY)).toBe('1');
    expect(await engine.getImage('old')).toBeUndefined();
    expect(await engine.getImage('mid')).toBeDefined();
    expect(await engine.getImage('pinned')).toBeDefined();
    expect(service.usage()).toEqual({ pinnedBytes: 5 * MB, unpinnedBytes: 0.8 * MB });
  });

  it('clears recently viewed images but keeps pinned ones', async () => {
    await engine.putImage(makeContractImageCacheRecord({ key: 'a', blob: new Blob(['x']) }));
    await engine.putImage(makeContractImageCacheRecord({ key: 'b', blob: new Blob(['x']) }));
    await engine.pinImages('intl:sv01', ['b']);
    await service.resolve('a'); // Creates an object URL to release.

    await service.clearRecentlyViewed();

    expect(await engine.getImage('a')).toBeUndefined();
    expect(await engine.getImage('b')).toBeDefined();
    expect(revoke).toHaveBeenCalledWith('blob:test-0');
  });

  it('refreshes an image’s last-viewed time at most hourly', async () => {
    const stale = '2026-01-01T00:00:00.000Z';
    await engine.putImage(
      makeContractImageCacheRecord({ key: URL_B, blob: new Blob(['x']), lastAccessedAt: stale })
    );

    await service.resolve(URL_B);
    const touched = (await engine.getImage(URL_B))?.lastAccessedAt;
    await service.resolve(URL_B);

    expect(touched).not.toBe(stale);
    expect((await engine.getImage(URL_B))?.lastAccessedAt).toBe(touched);
  });

  it('reads the stored limit', async () => {
    preferences.set(IMAGE_CACHE_LIMIT_KEY, '2000');

    await service.refreshUsage();

    expect(service.limitMb()).toBe(2000);
  });
});
