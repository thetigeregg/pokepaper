import 'fake-indexeddb/auto';
import { Injector, signal } from '@angular/core';
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
import { SEARCH_ROW_VERSION_KEY } from './catalog-search-index.service';
import {
  CatalogSearchService,
  NO_FILTERS,
  categoryValues,
  hasFilters,
} from './catalog-search.service';
import { CatalogSyncService } from './catalog-sync.service';
import { CollectionService } from './collection.service';
import { MAX_RECENT_SEARCHES, RECENT_SEARCHES_KEY } from './recent-searches.service';

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
  /** Copies owned, by `cardId:language`. */
  const owned = signal<Record<string, number>>({});
  /** Which language each catalog's sets open in (when they have it). */
  const remembered = signal<Record<string, string>>({ intl: 'en', asia: 'ja' });
  const collectionLoaded = signal(true);

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
    owned.set({});
    remembered.set({ intl: 'en', asia: 'ja' });
    collectionLoaded.set(true);
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
          useValue: {
            languages: remembered,
            forSet: (region: string, languages: string[]) => {
              const language = remembered()[region] ?? 'en';
              return languages.includes(language) ? language : (languages[0] ?? language);
            },
          },
        },
        {
          provide: CollectionService,
          useValue: {
            loaded: collectionLoaded,
            cardTotalByKey: (cardKey: string, language: string) =>
              owned()[`${cardKey.slice(cardKey.indexOf(':') + 1)}:${language}`] ?? 0,
          },
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

  it('gives another screen its own query and filters over one shared index', async () => {
    const listRows = vi.spyOn(engine, 'listCatalogSearchRows');
    const cards = await create();
    // What a deck's Add cards does: its own instance through component providers.
    const deck = Injector.create({
      providers: [CatalogSearchService],
      parent: TestBed.inject(Injector),
    }).get(CatalogSearchService);

    cards.setQuery('pika');
    deck.setFilters({ ...NO_FILTERS, types: ['Grass'] });
    deck.setQuery('pom');
    await cards.rememberQuery();

    expect(deck).not.toBe(cards);
    expect(keys(cards)).toEqual(['intl:sv02-1', 'intl:sv01-2', 'intl:swsh1-1']);
    expect(cards.filters()).toEqual(NO_FILTERS);
    expect(keys(deck)).toEqual(['intl:sv01-1']);
    expect(deck.ready()).toBe(true);
    // One copy of the rows, loaded once; recent searches are shared.
    expect(listRows).toHaveBeenCalledTimes(1);
    expect(deck.recent()).toEqual(['pika']);
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

  describe('collection filter', () => {
    it('finds owned and missing cards, either or both', async () => {
      owned.set({ 'sv01-2:en': 1, 'swsh1-1:en': 3 });
      const service = await create();

      service.setFilters({ ...NO_FILTERS, owned: ['owned'] });
      expect(keys(service)).toEqual(['intl:sv01-2', 'intl:swsh1-1']);

      service.setFilters({ ...NO_FILTERS, owned: ['missing'] });
      expect(keys(service)).toEqual(['intl:sv02-1', 'intl:sv01-1', 'intl:sv01-3']);

      service.setFilters({ ...NO_FILTERS, owned: ['owned', 'missing'] });
      expect(keys(service)).toHaveLength(5);

      service.setFilters({ ...NO_FILTERS, owned: ['missing'], sets: ['intl:sv01'] });
      expect(keys(service)).toEqual(['intl:sv01-1', 'intl:sv01-3']); // The set's want list.
    });

    it('counts copies in the language each set opens in', async () => {
      owned.set({ 'sv01-2:de': 1 });
      const service = await create();
      service.setFilters({ ...NO_FILTERS, owned: ['owned'] });
      expect(keys(service)).toEqual([]); // Owned in German; sets open in English.

      remembered.set({ intl: 'de', asia: 'ja' }); // The contract sets are English-only…
      expect(keys(service)).toEqual([]);
      owned.set({ 'sv01-2:en': 1 }); // …so they still open, and count, in English.
      service.setFilters({ ...NO_FILTERS, owned: ['owned'] });
      expect(keys(service)).toEqual(['intl:sv01-2']);
    });

    it('keeps results steady as quantities change, rereading status when the search changes', async () => {
      const service = await create();
      service.setFilters({ ...NO_FILTERS, owned: ['missing'], sets: ['intl:sv02'] });
      expect(keys(service)).toEqual(['intl:sv02-1']);

      owned.set({ 'sv02-1:en': 1 }); // Added from the card modal.
      expect(keys(service)).toEqual(['intl:sv02-1']); // Still listed while paging.

      service.setQuery('');
      expect(keys(service)).toEqual([]);
      owned.set({});
      service.activate();
      expect(keys(service)).toEqual(['intl:sv02-1']);
    });

    it('rereads status once the collection has loaded', async () => {
      collectionLoaded.set(false);
      const service = await create();
      service.setFilters({ ...NO_FILTERS, owned: ['owned'] });
      expect(keys(service)).toEqual([]);

      owned.set({ 'sv01-1:en': 2 });
      collectionLoaded.set(true);

      expect(keys(service)).toEqual(['intl:sv01-1']);
    });

    it('counts owned and missing cards, both always listed, narrowed by the other filters', async () => {
      owned.set({ 'sv01-2:en': 1 });
      const service = await create();

      expect(service.ownedCounts()).toEqual([
        { value: 'owned', count: 1 },
        { value: 'missing', count: 4 },
      ]);

      service.setFilters({ ...NO_FILTERS, owned: ['owned'], types: ['Grass'] });
      expect(service.ownedCounts()).toEqual([
        { value: 'owned', count: 0 },
        { value: 'missing', count: 1 },
      ]);
      // The collection pick narrows the other filters' counts.
      expect(service.counts().types).toEqual([{ value: 'Lightning', count: 1 }]);
    });
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

  it.each(['succeeds', 'fails'])('drops a load that %s after a newer one', async (outcome) => {
    const service = await create();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const realList = engine.listCatalogSearchRows.bind(engine);
    const intlRows = await realList('intl');
    let finishSlowLoad: () => void = () => undefined;
    const listRows = vi
      .spyOn(engine, 'listCatalogSearchRows')
      .mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            finishSlowLoad = () => {
              if (outcome === 'succeeds') {
                resolve(intlRows);
              } else {
                reject(new Error('late'));
              }
            };
          })
      )
      .mockImplementation(realList);

    changed.next(); // The catalog updated: reload International (slowly).
    await vi.waitFor(() => {
      expect(listRows).toHaveBeenCalledTimes(1);
    });
    await TestBed.inject(CatalogBrowseService).setRegion('asia');
    TestBed.tick();
    service.setQuery('pika');
    expect(keys(service)).toEqual([]); // International's rows don't answer for Asia.
    await vi.waitFor(() => {
      expect(service.ready()).toBe(true);
    });
    finishSlowLoad();
    await new Promise((resolve) => setTimeout(resolve));

    expect(service.failed()).toBe(false);
    service.setQuery('ぴか');
    expect(keys(service)).toEqual(['asia:SV2a-1']);
    error.mockRestore();
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
