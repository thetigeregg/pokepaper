import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ModalController } from '@ionic/angular';
import type { CatalogCard } from '@pokepaper/shared';
import { vi } from 'vitest';
import { makeContractCard, makeContractPack } from '../../core/data/storage-engine.contract';
import { StorageEngineFactory } from '../../core/data/storage-engine.factory';
import { CatalogLanguageService } from '../../core/services/catalog-language.service';
import { CollectionService } from '../../core/services/collection.service';
import {
  CatalogSearchService,
  type SearchResults,
} from '../../core/services/catalog-search.service';
import { ImageCacheService } from '../../core/services/image-cache.service';
import { LayoutService } from '../../core/services/layout.service';
import { VisibilityService } from '../../core/services/visibility.service';
import { CardDetailComponent } from './card-detail.component';
import { RESULTS_PAGE_SIZE, SearchResultsComponent } from './search-results.component';

/** An empty collection, for specs that don't test collection tracking. */
const EMPTY_COLLECTION: Partial<CollectionService> = {
  loaded: signal(true),
  quantity: () => 0,
  cardTotal: () => 0,
  otherLanguages: () => [],
  ownedInSet: () => 0,
};

describe('SearchResultsComponent', () => {
  const sv01 = { ...makeContractPack('intl', 'sv01', []).set, names: { en: 'Scarlet & Violet' } };
  const sv02 = { ...makeContractPack('intl', 'sv02', []).set, names: { en: 'Paldea Evolved' } };
  const card = (setId: string, n: number): CatalogCard =>
    makeContractCard('intl', setId, `${setId}-${String(n).padStart(3, '0')}`, n);
  const result = (cards: CatalogCard[]): SearchResults => {
    const perSet = new Map<string, number>();
    for (const entry of cards) {
      perSet.set(`intl:${entry.setId}`, (perSet.get(`intl:${entry.setId}`) ?? 0) + 1);
    }
    return {
      cards: cards.map((entry) => ({ key: `intl:${entry.id}`, setKey: `intl:${entry.setId}` })),
      perSet,
    };
  };

  const stored = new Map<string, CatalogCard>();
  const engine = {
    getCatalogCardsByKey: vi.fn((keys: readonly string[]) =>
      Promise.resolve(keys.flatMap((key) => stored.get(key) ?? []))
    ),
  };
  const search = {
    searching: signal(true),
    ready: signal(true),
    failed: signal(false),
    retry: vi.fn(),
    results: signal<SearchResults>({ cards: [], perSet: new Map() }),
    sets: signal(
      new Map([
        ['intl:sv02', { set: sv02, seriesKey: 'intl:sv', order: 0 }],
        ['intl:sv01', { set: sv01, seriesKey: 'intl:sv', order: 1 }],
      ])
    ),
    language: signal('en'),
    recent: signal<string[]>([]),
    setQuery: vi.fn(),
    rememberQuery: vi.fn(() => Promise.resolve()),
    clearRecent: vi.fn(() => Promise.resolve()),
  };
  const wide = signal(false);
  const present = vi.fn(() => Promise.resolve());
  const createModal = vi.fn(() => Promise.resolve({ present }));

  let fixture: ComponentFixture<SearchResultsComponent>;

  async function create(): Promise<SearchResultsComponent> {
    fixture = TestBed.createComponent(SearchResultsComponent);
    fixture.detectChanges();
    await settle();
    return fixture.componentInstance;
  }

  /** Lets page loads (native async/await, which Zone.js can't track) finish, then renders. */
  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }

  const root = () => fixture.nativeElement as HTMLElement;
  const query = (selector: string) => root().querySelector(selector);

  beforeEach(() => {
    vi.clearAllMocks();
    stored.clear();
    search.searching.set(true);
    search.ready.set(true);
    search.recent.set([]);
    search.results.set({ cards: [], perSet: new Map() });
    wide.set(false);
    TestBed.configureTestingModule({
      providers: [
        { provide: CollectionService, useValue: EMPTY_COLLECTION },
        { provide: CatalogSearchService, useValue: search },
        { provide: StorageEngineFactory, useValue: { getEngine: () => engine } },
        { provide: CatalogLanguageService, useValue: { forSet: () => 'en' } },
        { provide: ModalController, useValue: { create: createModal } },
        { provide: LayoutService, useValue: { wide } },
        {
          provide: ImageCacheService,
          useValue: { resolve: vi.fn(() => Promise.resolve(null)), release: vi.fn() },
        },
        { provide: VisibilityService, useValue: { whenVisible: () => () => undefined } },
      ],
    });
  });

  function store(cards: CatalogCard[]): void {
    for (const entry of cards) {
      stored.set(`intl:${entry.id}`, entry);
    }
  }

  it('lists recent searches before there is a query, to search again or clear', async () => {
    search.searching.set(false);
    search.recent.set(['pika', 'pineco']);
    const results = await create();

    const rows = root().querySelectorAll('[data-testid="recent-search"]');
    expect(rows).toHaveLength(2);
    (rows[1] as HTMLElement).click();
    expect(search.setQuery).toHaveBeenCalledWith('pineco');
    expect(search.rememberQuery).toHaveBeenCalled();

    (query('[data-testid="clear-recent"]') as HTMLElement).click();
    expect(search.clearRecent).toHaveBeenCalled();
    expect(results.loaded()).toEqual([]);
  });

  it('explains search when there are no recent searches', async () => {
    search.searching.set(false);
    await create();

    expect(query('[data-testid="search-hint"]')).not.toBeNull();
  });

  it('says when nothing matches, or when there is no catalog yet', async () => {
    await create();
    expect(query('[data-testid="no-results"]')?.textContent).toContain('fewer filters');

    search.sets.set(new Map());
    fixture.detectChanges();
    expect(query('[data-testid="no-results"]')?.textContent).toContain('catalog downloads');
    search.sets.set(
      new Map([
        ['intl:sv02', { set: sv02, seriesKey: 'intl:sv', order: 0 }],
        ['intl:sv01', { set: sv01, seriesKey: 'intl:sv', order: 1 }],
      ])
    );
  });

  it('groups the matching cards by set with counts, skipping cards no longer stored', async () => {
    const cards = [card('sv02', 1), card('sv01', 2), card('sv01', 5), card('sv01', 9)];
    store(cards.slice(0, 3));
    search.results.set(result(cards));
    const results = await create();

    expect(query('[data-testid="results-summary"]')?.textContent).toBe('4 cards in 2 sets');
    expect(results.groups().map((group) => [group.name, group.count, group.cards.length])).toEqual([
      ['Paldea Evolved', 1, 1],
      ['Scarlet & Violet', 3, 2],
    ]);
    expect([...root().querySelectorAll('.caption')].map((c) => c.textContent)).toEqual([
      '001 · sv02-001',
      '002 · sv01-002',
      '005 · sv01-005',
    ]);
  });

  it('loads more cards as the results scroll', async () => {
    const cards = Array.from({ length: RESULTS_PAGE_SIZE + 5 }, (_, n) => card('sv01', n + 1));
    store(cards);
    search.results.set(result(cards));
    const results = await create();
    expect(results.loaded()).toHaveLength(RESULTS_PAGE_SIZE);
    expect(results.allLoaded()).toBe(false);
    expect(query('[data-testid="results-summary"]')?.textContent).toBe('65 cards in 1 set');

    const complete = vi.fn(() => Promise.resolve());
    await results.more({ target: { complete } } as never);

    expect(results.loaded()).toHaveLength(RESULTS_PAGE_SIZE + 5);
    expect(results.allLoaded()).toBe(true);
    expect(complete).toHaveBeenCalled();
    await results.loadMore(); // Nothing left: no request.
    expect(engine.getCatalogCardsByKey).toHaveBeenCalledTimes(2);
  });

  it('drops a page that finishes after the results changed', async () => {
    const first = [card('sv01', 1)];
    const second = [card('sv02', 1)];
    store([...first, ...second]);
    let release!: () => void;
    engine.getCatalogCardsByKey.mockImplementationOnce(
      (keys: readonly string[]) =>
        new Promise((resolve) => {
          release = () => {
            resolve(keys.flatMap((key) => stored.get(key) ?? []));
          };
        })
    );
    search.results.set(result(first));
    fixture = TestBed.createComponent(SearchResultsComponent);
    fixture.detectChanges();

    search.results.set(result(second));
    fixture.detectChanges();
    release();
    await settle();

    expect(fixture.componentInstance.loaded().map((entry) => entry.key)).toEqual(['intl:sv02-001']);
  });

  it('opens a card in the modal, paging through the results, and remembers the search', async () => {
    const cards = [card('sv02', 1), card('sv01', 2)];
    store(cards);
    search.results.set(result(cards));
    await create();

    (root().querySelectorAll('.card-button')[1] as HTMLButtonElement).click();
    await settle();

    expect(search.rememberQuery).toHaveBeenCalled();
    const modalProps = (createModal.mock.lastCall as unknown as [Record<string, unknown>])[0];
    expect(modalProps['componentProps']).toMatchObject({
      setsProp: new Map([
        ['intl:sv02', sv02],
        ['intl:sv01', sv01],
      ]),
      cardsProp: cards,
      startIndex: 1,
    });
    expect(createModal).toHaveBeenCalledWith(
      expect.objectContaining({
        component: CardDetailComponent,
        breakpoints: [0, 1],
      })
    );
    expect(present).toHaveBeenCalled();
  });

  describe('with a picker (a deck\u2019s Add cards)', () => {
    const counts = signal<Record<string, number>>({});
    const picker = {
      count: vi.fn((picked: CatalogCard) => counts()[picked.id] ?? 0),
      pick: vi.fn(),
    };

    beforeEach(() => {
      counts.set({});
    });

    async function createPicking(cards: CatalogCard[]): Promise<void> {
      store(cards);
      search.results.set(result(cards));
      fixture = TestBed.createComponent(SearchResultsComponent);
      fixture.componentRef.setInput('picker', picker);
      fixture.detectChanges();
      await settle();
    }

    it('picks a tapped card instead of opening it, remembering the search', async () => {
      const cards = [card('sv02', 1), card('sv01', 2)];
      await createPicking(cards);

      (root().querySelectorAll('.card-button')[1] as HTMLButtonElement).click();

      expect(picker.pick).toHaveBeenCalledWith(cards[1]);
      expect(search.rememberQuery).toHaveBeenCalled();
      expect(createModal).not.toHaveBeenCalled();
    });

    it('badges the copies picked, updating as they change', async () => {
      const cards = [card('sv02', 1), card('sv01', 2)];
      counts.set({ 'sv01-002': 3 });
      await createPicking(cards);

      const badges = () =>
        [...root().querySelectorAll('[data-testid="in-deck-badge"]')].map((badge) =>
          badge.textContent.trim()
        );
      expect(badges()).toEqual(['3']);

      counts.set({ 'sv01-002': 4, 'sv02-001': 1 });
      fixture.detectChanges();
      expect(badges()).toEqual(['1', '4']);
    });

    it('opens a card from its info button, paging through the results', async () => {
      const cards = [card('sv02', 1), card('sv01', 2)];
      await createPicking(cards);

      (root().querySelectorAll('[data-testid="tile-info"]')[1] as HTMLElement).click();
      await settle();

      expect(picker.pick).not.toHaveBeenCalled();
      const modalProps = (createModal.mock.lastCall as unknown as [Record<string, unknown>])[0];
      expect(modalProps['componentProps']).toMatchObject({ cardsProp: cards, startIndex: 1 });
    });

    it('shows no info buttons without a picker', async () => {
      const cards = [card('sv02', 1)];
      store(cards);
      search.results.set(result(cards));
      await create();

      expect(root().querySelector('[data-testid="tile-info"]')).toBeNull();
      expect(root().querySelector('[data-testid="in-deck-badge"]')).toBeNull();
    });
  });

  it('lets the card modal load the next page of results', async () => {
    const cards = Array.from({ length: RESULTS_PAGE_SIZE + 3 }, (_, n) => card('sv01', n + 1));
    store(cards);
    search.results.set(result(cards));
    const results = await create();

    await results.openCard(0);
    const props = (
      createModal.mock.lastCall as unknown as [{ componentProps: Record<string, unknown> }]
    )[0].componentProps;
    const loadMore = props['loadMoreProp'] as () => Promise<CatalogCard[]>;

    expect(await loadMore()).toHaveLength(RESULTS_PAGE_SIZE + 3);
    expect(results.allLoaded()).toBe(true);
  });

  it('opens cards in a centered dialog on desktop', async () => {
    wide.set(true);
    const cards = [card('sv01', 1)];
    store(cards);
    search.results.set(result(cards));
    const results = await create();

    await results.openCard(0);

    expect(createModal.mock.lastCall?.[0]).not.toHaveProperty('breakpoints');
  });

  it('names a set no longer listed by its ID', async () => {
    const cards = [card('gone', 1)];
    store(cards);
    search.results.set(result(cards));
    const results = await create();

    const group = results.groups().at(0);
    expect(group?.name).toBe('gone');
    expect(group && results.line(group, cards[0])).toBe('001');
  });

  it('keeps what loaded when a page fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    engine.getCatalogCardsByKey.mockRejectedValueOnce(new Error('disk'));
    const cards = [card('sv01', 1)];
    store(cards);
    search.results.set(result(cards));
    const results = await create();

    expect(results.loaded()).toEqual([]);
    expect(error).toHaveBeenCalledWith('catalog.search_page_failed', expect.any(Error));
    await results.loadMore(); // Scrolling tries again.
    expect(results.loaded()).toHaveLength(1);
    error.mockRestore();
  });

  it("keeps paging by position when a card isn't stored, and stops at the end", async () => {
    const cards = Array.from({ length: RESULTS_PAGE_SIZE + 2 }, (_, n) => card('sv01', n + 1));
    store(cards.filter((_, n) => n !== 3)); // One card gone since the results were worked out.
    search.results.set(result(cards));
    const results = await create();
    expect(results.loaded()).toHaveLength(RESULTS_PAGE_SIZE - 1);

    await results.loadMore();

    const keys = results.loaded().map((entry) => entry.key);
    expect(keys).toHaveLength(RESULTS_PAGE_SIZE + 1);
    expect(new Set(keys).size).toBe(keys.length); // No card twice.
    expect(results.allLoaded()).toBe(true);
  });

  it('keeps what is loaded when the same results are worked out again', async () => {
    const cards = Array.from({ length: RESULTS_PAGE_SIZE + 5 }, (_, n) => card('sv01', n + 1));
    store(cards);
    search.results.set(result(cards));
    const results = await create();
    await results.loadMore();
    expect(results.loaded()).toHaveLength(RESULTS_PAGE_SIZE + 5);

    search.results.set(result(cards)); // A new object with the same cards (index reloaded).
    fixture.detectChanges();
    await settle();

    expect(results.loaded()).toHaveLength(RESULTS_PAGE_SIZE + 5);
    expect(engine.getCatalogCardsByKey).toHaveBeenCalledTimes(2);
  });

  it("doesn't load a page twice when an older page finishes during a newer one", async () => {
    const first = [card('sv01', 1)];
    const second = Array.from({ length: RESULTS_PAGE_SIZE + 5 }, (_, n) => card('sv02', n + 1));
    store([...first, ...second]);
    const releases: (() => void)[] = [];
    engine.getCatalogCardsByKey.mockImplementation(
      (keys: readonly string[]) =>
        new Promise((resolve) => {
          releases.push(() => {
            resolve(keys.flatMap((key) => stored.get(key) ?? []));
          });
        })
    );
    search.results.set(result(first));
    fixture = TestBed.createComponent(SearchResultsComponent);
    fixture.detectChanges(); // Page 1 of the first results starts.
    search.results.set(result(second));
    fixture.detectChanges(); // Page 1 of the second results starts.
    const results = fixture.componentInstance;

    releases[0]?.(); // The older page finishes first…
    await settle();
    void results.loadMore(); // …and scrolling must not start a second page 1.
    expect(engine.getCatalogCardsByKey).toHaveBeenCalledTimes(2);

    releases[1]?.();
    await settle();
    expect(results.loaded()).toHaveLength(RESULTS_PAGE_SIZE);
    engine.getCatalogCardsByKey.mockImplementation((keys: readonly string[]) =>
      Promise.resolve(keys.flatMap((key) => stored.get(key) ?? []))
    );
  });

  it('offers to try again when search failed to load', async () => {
    search.failed.set(true);
    search.ready.set(false);
    await create();

    expect(query('[data-testid="search-failed"]')).not.toBeNull();
    (query('[data-testid="search-retry"]') as HTMLElement).click();
    expect(search.retry).toHaveBeenCalled();
    search.failed.set(false);
  });

  it('shows a loading row until the catalog is ready', async () => {
    search.ready.set(false);
    await create();

    expect(root().textContent).toContain('Loading cards');
  });
});
