import 'fake-indexeddb/auto';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CatalogCard, CatalogSetPack } from '@pokepaper/shared';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { AppDb } from '../data/app-db';
import { CATALOG_SEARCH_ROW_VERSION } from '../data/catalog-search-row';
import { DexieStorageEngine } from '../data/dexie-storage-engine';
import { makeContractCard, makeContractPack } from '../data/storage-engine.contract';
import { StorageEngineFactory } from '../data/storage-engine.factory';
import { PreferenceStorageService } from '../storage/preference-storage.service';
import { CatalogBrowseService } from './catalog-browse.service';
import { CatalogLanguageService } from './catalog-language.service';
import {
  CatalogSearchService,
  MAX_RECENT_SEARCHES,
  NO_FILTERS,
  RECENT_SEARCHES_KEY,
  SEARCH_ROW_VERSION_KEY,
  categoryValues,
  hasFilters,
} from './catalog-search.service';
import { CatalogSyncService } from './catalog-sync.service';

vi.mock(
  '../data/storage-transaction-context',
  () => import('../data/storage-transaction-context.node')
);

type CardOverrides = Partial<CatalogCard> & { names: Partial<Record<'en' | 'fr' | 'ja', string>> };

function pack(
  region: 'intl' | 'asia',
  id: string,
  serie: string,
  releaseDate: string,
  cards: CardOverrides[]
): CatalogSetPack {
  const result = makeContractPack(region, id, []);
  result.set = { ...result.set, serieId: serie, releaseDate, names: { en: id } };
  result.cards = cards.map(({ names, ...overrides }, index) => {
    const card = makeContractCard(region, id, `${id}-${String(index + 1)}`, index);
    const base = card.text.en;
    if (!base) {
      throw new Error('The contract card has English text');
    }
    return {
      ...card,
      ...overrides,
      text: Object.fromEntries(
        Object.entries(names).map(([language, name]) => [language, { ...base, name }])
      ),
    };
  });
  return result;
}

const SV01 = pack('intl', 'sv01', 'sv', '2023-03-31', [
  { names: { en: 'Pineco', fr: 'Pomdépik' } },
  { names: { en: 'Pikachu' }, types: ['Lightning'], rarity: 'Rare' },
  {
    names: { en: "Professor's Research" },
    category: 'Trainer',
    trainerType: 'Supporter',
    types: [],
    rarity: null,
  },
]);
const SV02 = pack('intl', 'sv02', 'sv', '2023-06-09', [
  { names: { en: 'Pikachu ex' }, types: ['Lightning'], rarity: 'Double rare' },
]);
const SWSH1 = pack('intl', 'swsh1', 'swsh', '2020-02-07', [
  { names: { en: 'Pikachu V' }, types: ['Lightning'], rarity: 'Rare' },
]);
const SV2A = pack('asia', 'SV2a', 'SV', '2023-06-16', [
  { names: { ja: 'ピカチュウ' }, types: ['Lightning'] },
]);

describe('CatalogSearchService', () => {
  let db: AppDb;
  let engine: DexieStorageEngine;
  const preferences = new Map<string, string>();
  const changed = new Subject<void>();

  async function create(): Promise<CatalogSearchService> {
    const service = TestBed.inject(CatalogSearchService);
    const browse = TestBed.inject(CatalogBrowseService);
    TestBed.tick();
    await vi.waitFor(() => {
      expect(service.ready()).toBe(true);
      expect(browse.loaded()).toBe(true);
    });
    return service;
  }

  const keys = (service: CatalogSearchService) => service.results().cards.map((card) => card.key);

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
        {
          provide: CatalogLanguageService,
          useValue: { languages: signal({ intl: 'en', asia: 'ja' }) },
        },
        { provide: CatalogSyncService, useValue: { changed$: changed.asObservable() } },
      ],
    });
    db = TestBed.inject(AppDb);
    engine = TestBed.inject(DexieStorageEngine);
    await engine.replaceCatalogSeries([
      { region: 'intl', id: 'sv', names: { en: 'Scarlet & Violet' }, logos: {} },
      { region: 'intl', id: 'swsh', names: { en: 'Sword & Shield' }, logos: {} },
      { region: 'asia', id: 'SV', names: { ja: 'スカーレット&バイオレット' }, logos: {} },
    ]);
    for (const set of [SV01, SV02, SWSH1, SV2A]) {
      await engine.replaceCatalogSet(set);
    }
  });

  afterEach(async () => {
    TestBed.resetTestingModule(); // Stops the services before their database goes.
    await db.delete();
  });

  it('finds names in any language of the catalog, newest set first, then by number', async () => {
    const service = await create();

    service.setQuery('pika');
    expect(keys(service)).toEqual(['intl:sv02-1', 'intl:sv01-2', 'intl:swsh1-1']);
    expect([...service.results().perSet]).toEqual([
      ['intl:sv02', 1],
      ['intl:sv01', 1],
      ['intl:swsh1', 1],
    ]);

    service.setQuery('POMDEPIK');
    expect(keys(service)).toEqual(['intl:sv01-1']);
    service.setQuery('professors');
    expect(keys(service)).toEqual(['intl:sv01-3']);
  });

  it('has no results until there is a query or a filter', async () => {
    const service = await create();

    service.setQuery('   ');

    expect(service.searching()).toBe(false);
    expect(service.results().cards).toEqual([]);
  });

  it('filters without a query, any value within a filter and every filter together', async () => {
    const service = await create();

    service.setFilters({ ...NO_FILTERS, types: ['Lightning'] });
    expect(keys(service)).toEqual(['intl:sv02-1', 'intl:sv01-2', 'intl:swsh1-1']);

    service.setFilters({ ...NO_FILTERS, types: ['Lightning'], rarities: ['Rare'] });
    expect(keys(service)).toEqual(['intl:sv01-2', 'intl:swsh1-1']);

    service.setFilters({ ...NO_FILTERS, rarities: ['Rare', 'Double rare'] });
    expect(keys(service)).toEqual(['intl:sv02-1', 'intl:sv01-2', 'intl:swsh1-1']);

    service.setFilters({ ...NO_FILTERS, categories: ['Trainer/Supporter'] });
    expect(keys(service)).toEqual(['intl:sv01-3']);
    service.setFilters({ ...NO_FILTERS, categories: ['Trainer'] });
    expect(keys(service)).toEqual(['intl:sv01-3']);
    service.setFilters({ ...NO_FILTERS, categories: ['Trainer/Item'] });
    expect(keys(service)).toEqual([]);
  });

  it('filters by whole series or single sets', async () => {
    const service = await create();

    service.setFilters({ ...NO_FILTERS, series: ['intl:sv'] });
    expect(keys(service)).toEqual(['intl:sv02-1', 'intl:sv01-1', 'intl:sv01-2', 'intl:sv01-3']);

    service.setFilters({ ...NO_FILTERS, series: ['intl:swsh'], sets: ['intl:sv02'] });
    expect(keys(service)).toEqual(['intl:sv02-1', 'intl:swsh1-1']);

    service.setQuery('pika');
    service.setFilters({ ...NO_FILTERS, sets: ['intl:sv01'] });
    expect(keys(service)).toEqual(['intl:sv01-2']);
  });

  it('counts filter values in the catalog, most common first', async () => {
    const service = await create();

    expect(service.counts().types).toEqual([
      { value: 'Lightning', count: 3 },
      { value: 'Grass', count: 1 },
    ]);
    expect(service.counts().categories).toEqual([
      { value: 'Pokemon', count: 4 },
      { value: 'Trainer', count: 1 },
      { value: 'Trainer/Supporter', count: 1 },
    ]);
    expect(service.counts().rarities.map((entry) => entry.value)).toEqual([
      'Rare',
      'Common',
      'Double rare',
    ]);
    expect([...service.counts().sets]).toEqual([
      ['intl:sv01', 3],
      ['intl:sv02', 1],
      ['intl:swsh1', 1],
    ]);
  });

  it('counts only what the query and the other filters leave', async () => {
    const service = await create();

    service.setQuery('pi'); // Pineco and the three Pikachu.
    expect(service.counts().types).toEqual([
      { value: 'Lightning', count: 3 },
      { value: 'Grass', count: 1 },
    ]);
    expect(service.counts().categories).toEqual([{ value: 'Pokemon', count: 4 }]);

    // A filter's own picks don't narrow its counts; the others' do.
    service.setFilters({ ...NO_FILTERS, types: ['Lightning'] });
    expect(service.counts().types.map((entry) => entry.value)).toEqual(['Lightning', 'Grass']);
    expect(service.counts().rarities).toEqual([
      { value: 'Rare', count: 2 },
      { value: 'Double rare', count: 1 },
    ]);
    expect([...service.counts().sets]).toEqual([
      ['intl:sv01', 1],
      ['intl:sv02', 1],
      ['intl:swsh1', 1],
    ]);

    service.setFilters({ ...NO_FILTERS, types: ['Lightning'], sets: ['intl:sv02'] });
    expect(service.counts().rarities).toEqual([{ value: 'Double rare', count: 1 }]);
    expect([...service.counts().sets]).toHaveLength(3); // Set picks don't narrow set counts.
  });

  it('searches the other catalog after switching, dropping its set filters', async () => {
    const service = await create();
    service.setFilters({ ...NO_FILTERS, types: ['Lightning'], sets: ['intl:sv01'] });

    await TestBed.inject(CatalogBrowseService).setRegion('asia');
    TestBed.tick();
    await vi.waitFor(() => {
      expect(service.ready()).toBe(true);
    });

    expect(service.filters()).toEqual({ ...NO_FILTERS, types: ['Lightning'] });
    service.setQuery('ぴか'); // Hiragana finds katakana.
    expect(keys(service)).toEqual(['asia:SV2a-1']);
  });

  it('reloads when the catalog changes', async () => {
    const service = await create();
    service.setQuery('pineco');
    await engine.deleteCatalogSet('intl', 'sv01');

    changed.next();

    await vi.waitFor(() => {
      expect(keys(service)).toEqual([]);
    });
  });

  it('builds search rows for a catalog stored before they existed', async () => {
    await db.catalogCardSearch.clear(); // As if downloaded by an older version.

    const service = await create();
    service.setQuery('pika');

    expect(keys(service)).toHaveLength(3);
    expect((await engine.getSyncMeta(SEARCH_ROW_VERSION_KEY))?.value).toBe(
      String(CATALOG_SEARCH_ROW_VERSION)
    );
  });

  it('tries the rebuild again on the next load after it fails', async () => {
    await db.catalogCardSearch.clear();
    const reindex = vi.spyOn(engine, 'reindexCatalogSet').mockRejectedValueOnce(new Error('disk'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const service = TestBed.inject(CatalogSearchService);
    TestBed.tick();
    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith('catalog.search_load_failed', expect.any(Error));
    });
    expect(service.ready()).toBe(false);
    expect(service.failed()).toBe(true);

    service.activate(); // Showing search again retries.

    await vi.waitFor(() => {
      expect(service.ready()).toBe(true);
    });
    service.setQuery('pika');
    expect(keys(service)).toHaveLength(3);
    expect(reindex.mock.calls.length).toBeGreaterThan(1);
    error.mockRestore();
  });

  it("names the catalog's series by key", async () => {
    const service = await create();
    expect(service.setNames().sets.size).toBe(3);
    expect(service.setNames().language).toBe('en');

    expect([...service.seriesNames()]).toEqual([
      ['intl:sv', 'Scarlet & Violet'],
      ['intl:swsh', 'Sword & Shield'],
    ]);
  });

  it("doesn't rebuild rows already built with this version", async () => {
    await engine.putSyncMeta({
      key: SEARCH_ROW_VERSION_KEY,
      value: String(CATALOG_SEARCH_ROW_VERSION),
    });
    const reindex = vi.spyOn(engine, 'reindexCatalogSet');

    await create();

    expect(reindex).not.toHaveBeenCalled();
  });

  it('shows search on query, hides it keeping the search, and exits clearing it', async () => {
    const service = await create();
    expect(service.active()).toBe(false);

    service.setQuery('pika');
    service.setFilters({ ...NO_FILTERS, types: ['Lightning'] });
    expect(service.active()).toBe(true);

    service.deactivate();
    expect(service.active()).toBe(false);
    expect(service.query()).toBe('pika');

    service.activate();
    service.exit();
    expect(service.active()).toBe(false);
    expect(service.query()).toBe('');
    expect(service.filters()).toEqual(NO_FILTERS);
  });

  describe('recent searches', () => {
    it('keeps the newest first, without repeats, up to the limit', async () => {
      const service = await create();

      for (const query of [
        'pika',
        ' Pineco ',
        'PIKA',
        '',
        'a',
        'b',
        'c',
        'd',
        'e',
        'f',
        'g',
        'h',
        'i',
        'j',
        'k',
      ]) {
        service.setQuery(query);
        await service.rememberQuery();
      }

      expect(service.recent()).toHaveLength(MAX_RECENT_SEARCHES);
      expect(service.recent().slice(0, 2)).toEqual(['k', 'j']);
      service.setQuery('Pineco');
      await service.rememberQuery();
      expect(service.recent().filter((query) => query.toLowerCase() === 'pineco')).toEqual([
        'Pineco',
      ]);
      expect(JSON.parse(preferences.get(RECENT_SEARCHES_KEY) ?? '[]')).toEqual(service.recent());
    });

    it('loads saved searches, ignoring anything malformed', async () => {
      preferences.set(RECENT_SEARCHES_KEY, JSON.stringify(['pika', 3, 'pineco']));

      const service = await create();

      await vi.waitFor(() => {
        expect(service.recent()).toEqual(['pika', 'pineco']);
      });
    });

    it('starts empty when the saved searches are unreadable', async () => {
      preferences.set(RECENT_SEARCHES_KEY, '{not json');
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const service = await create();

      await vi.waitFor(() => {
        expect(error).toHaveBeenCalledWith(
          'catalog.recent_searches_load_failed',
          expect.any(Error)
        );
      });
      expect(service.recent()).toEqual([]);
      error.mockRestore();
    });

    it('keeps a search for this session when saving it fails', async () => {
      const service = await create();
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.spyOn(TestBed.inject(PreferenceStorageService), 'setItem').mockRejectedValueOnce(
        new Error('full')
      );

      service.setQuery('pika');
      await service.rememberQuery();

      expect(service.recent()).toEqual(['pika']);
      expect(error).toHaveBeenCalledWith('catalog.recent_searches_save_failed', expect.any(Error));
      error.mockRestore();
    });

    it("waits for the saved searches before saving, so they aren't overwritten", async () => {
      preferences.set(RECENT_SEARCHES_KEY, JSON.stringify(['pineco']));
      let release!: () => void;
      const prefs = TestBed.inject(PreferenceStorageService);
      const getItem = prefs.getItem.bind(prefs);
      vi.spyOn(prefs, 'getItem').mockImplementationOnce(
        (key) =>
          new Promise((resolve) => {
            release = () => {
              resolve(getItem(key));
            };
          })
      );
      const service = TestBed.inject(CatalogSearchService);

      service.setQuery('pika');
      const remembered = service.rememberQuery(); // Before the saved list has loaded.
      release();
      await remembered;

      expect(service.recent()).toEqual(['pika', 'pineco']);
      expect(JSON.parse(preferences.get(RECENT_SEARCHES_KEY) ?? '[]')).toEqual(['pika', 'pineco']);
    });

    it('clears them', async () => {
      preferences.set(RECENT_SEARCHES_KEY, JSON.stringify(['pika']));
      const service = await create();

      await service.clearRecent();

      expect(service.recent()).toEqual([]);
      expect(preferences.get(RECENT_SEARCHES_KEY)).toBe('[]');
    });
  });
});

describe('search helpers', () => {
  it('tells whether any filter is in use', () => {
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(hasFilters({ ...NO_FILTERS, sets: ['intl:sv01'] })).toBe(true);
  });

  it('gives a card its category with and without subtype', () => {
    expect(categoryValues({ category: 'Pokemon', subtype: null })).toEqual(['Pokemon']);
    expect(categoryValues({ category: 'Energy', subtype: 'Special' })).toEqual([
      'Energy',
      'Energy/Special',
    ]);
  });
});
