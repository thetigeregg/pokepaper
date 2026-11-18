import 'fake-indexeddb/auto';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { AppDb } from '../data/app-db';
import { DexieStorageEngine } from '../data/dexie-storage-engine';
import { makeContractPack } from '../data/storage-engine.contract';
import { StorageEngineFactory } from '../data/storage-engine.factory';
import { PreferenceStorageService } from '../storage/preference-storage.service';
import { CATALOG_REGION_KEY, CatalogBrowseService, localized } from './catalog-browse.service';
import { CatalogLanguageService } from './catalog-language.service';
import { CatalogSyncService } from './catalog-sync.service';

vi.mock(
  '../data/storage-transaction-context',
  () => import('../data/storage-transaction-context.node')
);

function pack(
  region: 'intl' | 'asia',
  id: string,
  serie: string,
  releaseDate: string,
  name: string
) {
  const result = makeContractPack(region, id, [`${id}-1`]);
  result.set = {
    ...result.set,
    serieId: serie,
    releaseDate,
    names: { en: name, de: `${name} (DE)` },
  };
  return result;
}

describe('localized', () => {
  it('uses the language, else the first value', () => {
    expect(localized({ en: 'Scarlet', de: 'Karmesin' }, 'de')).toBe('Karmesin');
    expect(localized({ fr: 'Écarlate' }, 'de')).toBe('Écarlate');
    expect(localized({}, 'de')).toBe('');
  });
});

describe('CatalogBrowseService', () => {
  let db: AppDb;
  let engine: DexieStorageEngine;
  const preferences = new Map<string, string>();
  const changed = new Subject<void>();
  const languages = signal({ intl: 'en' as const, asia: 'ja' as const });

  async function create(): Promise<CatalogBrowseService> {
    const service = TestBed.inject(CatalogBrowseService);
    TestBed.tick();
    await vi.waitFor(() => {
      expect(service.loaded()).toBe(true);
    });
    return service;
  }

  beforeEach(async () => {
    preferences.clear();
    TestBed.configureTestingModule({
      providers: [
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
        { provide: CatalogLanguageService, useValue: { languages } },
        { provide: CatalogSyncService, useValue: { changed$: changed.asObservable() } },
      ],
    });
    db = TestBed.inject(AppDb);
    engine = TestBed.inject(DexieStorageEngine);
    await engine.replaceCatalogSeries([
      {
        region: 'intl',
        id: 'sv',
        names: { en: 'Scarlet & Violet', de: 'Karmesin & Purpur' },
        logos: {},
      },
      { region: 'intl', id: 'swsh', names: { en: 'Sword & Shield' }, logos: {} },
      { region: 'asia', id: 'SV', names: { ja: 'スカーレット&バイオレット' }, logos: {} },
    ]);
    await engine.replaceCatalogSet(pack('intl', 'sv01', 'sv', '2023-03-31', 'Scarlet & Violet'));
    await engine.replaceCatalogSet(pack('intl', 'sv02', 'sv', '2023-06-09', 'Paldea Evolved'));
    await engine.replaceCatalogSet(pack('intl', 'swsh1', 'swsh', '2020-02-07', 'Sword & Shield'));
    await engine.replaceCatalogSet(pack('asia', 'SV2a', 'SV', '2023-06-16', '151'));
  });

  afterEach(async () => {
    TestBed.resetTestingModule(); // Stops the service before its database goes.
    await db.delete();
  });

  it('groups the catalog’s sets by series, newest first', async () => {
    const service = await create();

    expect(service.groups().map((group) => [group.name, group.sets.map((set) => set.id)])).toEqual([
      ['Scarlet & Violet', ['sv02', 'sv01']],
      ['Sword & Shield', ['swsh1']],
    ]);
  });

  it('switches catalogs and remembers the choice', async () => {
    const service = await create();

    await service.setRegion('asia');
    TestBed.tick();

    await vi.waitFor(() => {
      expect(service.groups().map((group) => group.name)).toEqual(['スカーレット&バイオレット']);
    });
    expect(preferences.get(CATALOG_REGION_KEY)).toBe('asia');
  });

  it('names series in the catalog’s current language', async () => {
    languages.set({ intl: 'de' as never, asia: 'ja' });
    const service = await create();

    expect(service.groups()[0]?.name).toBe('Karmesin & Purpur');
    languages.set({ intl: 'en', asia: 'ja' });
  });

  it('reloads when the catalog changes', async () => {
    const service = await create();
    await engine.replaceCatalogSet(pack('intl', 'sv03', 'sv', '2023-08-11', 'Obsidian Flames'));

    changed.next();

    await vi.waitFor(() => {
      expect(service.groups()[0]?.sets[0]?.id).toBe('sv03');
    });
  });

  it('keeps a catalog picked before the stored one has loaded', async () => {
    preferences.set(CATALOG_REGION_KEY, 'intl');
    const service = TestBed.inject(CatalogBrowseService);

    await service.setRegion('asia');
    TestBed.tick();
    await vi.waitFor(() => {
      expect(service.loaded()).toBe(true);
    });

    expect(service.region()).toBe('asia');
  });
});
