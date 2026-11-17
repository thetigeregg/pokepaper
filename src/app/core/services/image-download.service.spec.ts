import 'fake-indexeddb/auto';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { CatalogCard } from '@pokepaper/shared';
import { vi } from 'vitest';
import { AppDb } from '../data/app-db';
import { DexieStorageEngine } from '../data/dexie-storage-engine';
import { makeContractPack } from '../data/storage-engine.contract';
import { StorageEngineFactory } from '../data/storage-engine.factory';
import { PreferenceStorageService } from '../storage/preference-storage.service';
import { IMAGE_DOWNLOAD_CONCURRENCY, ImageDownloadService } from './image-download.service';

vi.mock(
  '../data/storage-transaction-context',
  () => import('../data/storage-transaction-context.node')
);

/** sv01 with three cards: 001 has en+de scans, 002 only en (de falls back), 003 none. */
function sv01() {
  const pack = makeContractPack('intl', 'sv01', ['sv01-001', 'sv01-002', 'sv01-003']);
  const text = (image: string | null) => ({
    name: 'x',
    description: null,
    effect: null,
    evolveFrom: null,
    attacks: [],
    abilities: [],
    image,
  });
  const byId = (id: string) => pack.cards.find((card) => card.id === id) as CatalogCard;
  byId('sv01-001').text = { en: text('en/sv/sv01/001'), de: text('de/sv/sv01/001') };
  byId('sv01-002').text = { en: text('en/sv/sv01/002'), de: text(null) };
  byId('sv01-003').text = { en: text(null), de: text(null) };
  pack.set.names = { en: 'Scarlet & Violet', de: 'Karmesin & Purpur' };
  return pack;
}

const img = (id: string, language: string) =>
  `/images/catalog/cards/intl/${id}/${language}/low.webp`;

describe('ImageDownloadService', () => {
  let db: AppDb;
  let engine: DexieStorageEngine;
  let httpMock: HttpTestingController;
  let service: ImageDownloadService;
  let responder: ((request: TestRequest) => void) | null;
  let stopResponding = false;

  /** Answers image requests as they arrive, until the test ends. */
  async function respondLoop(): Promise<void> {
    while (!stopResponding) {
      for (const request of httpMock.match(() => true)) {
        responder?.(request);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  beforeEach(async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
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
          useValue: { getItem: () => Promise.resolve(null), setItem: () => Promise.resolve() },
        },
      ],
    });
    db = TestBed.inject(AppDb);
    engine = TestBed.inject(DexieStorageEngine);
    httpMock = TestBed.inject(HttpTestingController);
    service = TestBed.inject(ImageDownloadService);
    await engine.replaceCatalogSet(sv01());
    responder = (request) => {
      request.flush(new Blob(['image']));
    };
    stopResponding = false;
    void respondLoop();
  });

  afterEach(async () => {
    stopResponding = true;
    vi.restoreAllMocks();
    await db.delete();
  });

  it('pins the scan each card shows in each language, including fallbacks', async () => {
    const requested: string[] = [];
    responder = (request) => {
      requested.push(request.request.url);
      request.flush(new Blob(['image']));
    };

    await service.downloadSet('intl', 'sv01', ['de']);

    // 001 in German; 002 falls back to English; 003 has no scan at all.
    expect(requested.sort()).toEqual([img('sv01-001', 'de'), img('sv01-002', 'en')]);
    expect(service.progress().get('intl:sv01')).toEqual({
      done: 2,
      total: 2,
      missing: 0,
      failed: 0,
      running: false,
    });
    expect(service.offlineSets()).toEqual([
      {
        setKey: 'intl:sv01',
        region: 'intl',
        setId: 'sv01',
        name: 'Scarlet & Violet',
        serieKey: 'intl:sv',
        serieName: 'sv',
        releaseDate: '2023-03-31',
        languages: ['de'],
        images: 2,
        bytes: 10,
      },
    ]);
    expect(service.totals()).toEqual({ sets: 1, bytes: 10 });
  });

  it('downloads each image once across languages, and only what is missing on a rerun', async () => {
    const requested: string[] = [];
    responder = (request) => {
      requested.push(request.request.url);
      request.flush(new Blob(['image']));
    };

    await service.downloadSet('intl', 'sv01', ['en', 'de']);
    expect(requested).toHaveLength(3); // 001 en, 001 de, 002 en (shared fallback).

    requested.length = 0;
    await service.downloadSet('intl', 'sv01', ['en', 'de']);
    expect(requested).toEqual([]);
  });

  it('counts images the server lacks or fails on without stopping', async () => {
    responder = (request) => {
      if (request.request.url.includes('001')) {
        request.flush(null, { status: 404, statusText: 'Not Found' });
      } else {
        request.flush(null, { status: 500, statusText: 'Server Error' });
      }
    };

    await service.downloadSet('intl', 'sv01', ['de']);

    expect(service.progress().get('intl:sv01')).toMatchObject({
      done: 2,
      missing: 1,
      failed: 1,
      running: false,
    });
  });

  it('stops after the images in flight when cancelled', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `big-${String(i).padStart(3, '0')}`);
    await engine.replaceCatalogSet(makeContractPack('intl', 'big', ids)); // Each card has an en scan.
    const requested: string[] = [];
    responder = (request) => {
      requested.push(request.request.url);
      service.cancel('intl', 'big');
      request.flush(new Blob(['image']));
    };

    await service.downloadSet('intl', 'big', ['en']);

    // At most the images already in flight finish; the rest never start.
    expect(requested.length).toBeLessThanOrEqual(IMAGE_DOWNLOAD_CONCURRENCY);
    expect(service.progress().get('intl:big')).toMatchObject({ total: 10, running: false });
  });

  it('remembers every language a set was downloaded in', async () => {
    await service.downloadSet('intl', 'sv01', ['de']);
    await service.downloadSet('intl', 'sv01', ['en']);

    expect(service.offlineSets()[0]?.languages).toEqual(['en', 'de']);
  });

  it('removes several sets at once', async () => {
    await engine.replaceCatalogSet(makeContractPack('intl', 'sv02', ['sv02-001']));
    await service.downloadSet('intl', 'sv01', ['de']);
    await service.downloadSet('intl', 'sv02', ['en']);

    await service.removeSets(['intl:sv01', 'intl:sv02']);

    expect(service.offlineSets()).toEqual([]);
    expect(await engine.listDownloadedSets()).toEqual([]);
  });

  it('removes a downloaded set, leaving its images evictable', async () => {
    await service.downloadSet('intl', 'sv01', ['de']);

    await service.removeSet('intl:sv01');

    expect(service.offlineSets()).toEqual([]);
    expect(service.progress().has('intl:sv01')).toBe(false);
    expect(await engine.listEvictableImages(10)).toHaveLength(2);
  });

  it('ignores languages from the other region', async () => {
    const requested: string[] = [];
    responder = (request) => {
      requested.push(request.request.url);
      request.flush(new Blob(['image']));
    };

    await service.downloadSet('intl', 'sv01', ['ja']);

    expect(requested).toEqual([]);
    expect(service.progress().get('intl:sv01')?.total).toBe(0);
  });
});
