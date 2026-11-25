import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type { CatalogRegion, CatalogSet } from '@pokepaper/shared';
import { catalogKey, type CatalogSearchRow } from '../data/storage-engine';
import { cardMatches, prepareQuery } from '../utils/search-text.util';
import { CatalogBrowseService } from './catalog-browse.service';
import { CatalogLanguageService } from './catalog-language.service';
import { CatalogSearchIndexService, type IndexedCard } from './catalog-search-index.service';
import { CollectionService } from './collection.service';
import { RecentSearchesService } from './recent-searches.service';

/**
 * Card filters (docs/catalog.md → Search). A card must match every filter
 * that has values, and any one value within a filter.
 */
export interface SearchFilters {
  /** A category (`Trainer`), or a category and subtype (`Trainer/Supporter`). */
  categories: string[];
  types: string[];
  rarities: string[];
  /** Series keys (`region:id`): any set in them. */
  series: string[];
  /** Set keys (`region:id`). */
  sets: string[];
  /** Illustrators by filter value (`illustratorKey`), so spellings TCGdex varies are one. */
  illustrators: string[];
  /**
   * Collection status (docs/collection.md): `owned` and/or `missing`, by the
   * copies owned in the language the card's set opens in.
   */
  owned: OwnedValue[];
}

export type OwnedValue = 'owned' | 'missing';

export const NO_FILTERS: SearchFilters = {
  categories: [],
  types: [],
  rarities: [],
  series: [],
  sets: [],
  illustrators: [],
  owned: [],
};

/** Matching cards, ordered like the sets list (newest set first), then by number. */
export interface SearchResults {
  cards: { key: string; setKey: string }[];
  /** How many matching cards each set has. */
  perSet: ReadonlyMap<string, number>;
}

/** A filter value and how many cards in the catalog have it. */
export interface FilterCount {
  value: string;
  count: number;
}

export function hasFilters(filters: SearchFilters): boolean {
  return Object.values(filters).some((values: string[]) => values.length > 0);
}

/** The card's `category` and, when it has one, `category/subtype`. */
export function categoryValues(row: Pick<CatalogSearchRow, 'category' | 'subtype'>): string[] {
  return row.subtype ? [row.category, `${row.category}/${row.subtype}`] : [row.category];
}

/**
 * One screen's card search (docs/ui.md → Cards → Search): the query, filters
 * and whether search is showing, and the results, over the current
 * catalog's search rows (`CatalogSearchIndexService`). Searching never
 * touches storage, so it keeps up with typing; the results page loads the
 * matching cards.
 *
 * The Cards tab uses the root instance. Another search screen (a deck's Add
 * cards) lists this class in its component `providers` for a search of its
 * own, and the search components it hosts open their overlays with its
 * injector so they use that search too. Recent searches are shared.
 */
@Injectable({ providedIn: 'root' })
export class CatalogSearchService {
  private readonly browse = inject(CatalogBrowseService);
  private readonly catalogLanguage = inject(CatalogLanguageService);
  private readonly collection = inject(CollectionService);
  private readonly searchIndex = inject(CatalogSearchIndexService);
  private readonly recentSearches = inject(RecentSearchesService);

  readonly region = this.browse.region;
  /** The language the current catalog's names are shown in. */
  readonly language = this.browse.language;

  private readonly _query = signal('');
  readonly query = this._query.asReadonly();
  private readonly _filters = signal<SearchFilters>(NO_FILTERS);
  readonly filters = this._filters.asReadonly();
  /** Search is showing in place of the sets list (phone) or the set (desktop). */
  private readonly _active = signal(false);
  readonly active = this._active.asReadonly();

  /** Recent searches, newest first (shared by every search screen). */
  readonly recent = this.recentSearches.recent;

  /** Whether the current catalog's search rows have loaded. */
  readonly ready = this.searchIndex.ready;
  /** The current catalog's search rows failed to load (see `retry`). */
  readonly failed = this.searchIndex.failed;

  /** There's a query or a filter, so results show rather than recent searches. */
  readonly searching = computed(
    () => prepareQuery(this._query()) !== null || hasFilters(this._filters())
  );

  /** The current catalog's sets by key, in sets-list order. */
  readonly sets = computed(() => {
    const sets = new Map<string, { set: CatalogSet; seriesKey: string; order: number }>();
    for (const group of this.browse.groups()) {
      for (const set of group.sets) {
        sets.set(catalogKey(set.region, set.id), { set, seriesKey: group.key, order: sets.size });
      }
    }
    return sets;
  });

  /** The language each set opens in, by set key: collection status is counted in it. */
  private readonly setLanguages = computed(
    () =>
      new Map(
        [...this.sets()].map(([key, { set }]) => [
          key,
          this.catalogLanguage.forSet(set.region, set.languages),
        ])
      )
  );

  /**
   * Bumped whenever the search changes (query, filters, showing search), so
   * collection status is read afresh then (see `ownedTest`).
   */
  private readonly searchChanges = signal(0);

  /**
   * Whether a card is owned in the language its set opens in (any variant).
   * Status is read when the search changes, the catalog or its language
   * changes, or the collection first loads, not on every quantity change:
   * adding a copy from the card modal while Missing is picked keeps the card
   * in the results (its badge updates) instead of reshuffling the list the
   * modal is paging through.
   */
  private readonly ownedTest = computed(() => {
    this.searchChanges();
    this.collection.loaded();
    const languages = this.setLanguages();
    const fallback = this.language();
    return (row: CatalogSearchRow): OwnedValue =>
      untracked(() =>
        this.collection.cardTotalByKey(row.key, languages.get(row.setKey) ?? fallback)
      ) > 0
        ? 'owned'
        : 'missing';
  });

  /**
   * How many cards the search leaves owned and missing, both always listed:
   * counted over the query and every other filter, like `counts`. Kept apart
   * so status is only looked up while the Collection picker shows.
   */
  readonly ownedCounts = computed<{ value: OwnedValue; count: number }[]>(() => {
    const owned = this.ownedTest();
    const filters = { ...this._filters(), owned: [] };
    const sets = this.sets();
    const tally: Record<OwnedValue, number> = { owned: 0, missing: 0 };
    for (const card of this.queryMatches()) {
      if (matchesFilters(card, filters, sets.get(card.row.setKey)?.seriesKey, owned)) {
        tally[owned(card.row)] += 1;
      }
    }
    return [
      { value: 'owned', count: tally.owned },
      { value: 'missing', count: tally.missing },
    ];
  });

  /** What the current catalog calls its sets, series and illustrators, for labeling filter picks. */
  readonly filterNames = computed(() => ({
    sets: this.sets(),
    seriesNames: this.seriesNames(),
    illustrators: this.searchIndex.illustrators(),
    language: this.language(),
  }));

  readonly seriesNames = computed(
    () => new Map(this.browse.groups().map((group) => [group.key, group.name]))
  );

  /** The current catalog's cards matching the query by name or number (all of them without one). */
  private readonly queryMatches = computed<IndexedCard[]>(() => {
    const cards = this.searchIndex.cards();
    const query = prepareQuery(this._query());
    return query ? cards.filter((card) => cardMatches(card, query)) : cards;
  });

  readonly results = computed<SearchResults>(() => {
    if (!this.searching()) {
      return { cards: [], perSet: new Map() };
    }
    const filters = this._filters();
    const sets = this.sets();
    const owned = this.ownedTest();
    const matches = this.queryMatches().filter((card) =>
      matchesFilters(card, filters, sets.get(card.row.setKey)?.seriesKey, owned)
    );
    const order = (setKey: string) => sets.get(setKey)?.order ?? Number.MAX_SAFE_INTEGER;
    matches.sort(
      (a, b) =>
        order(a.row.setKey) - order(b.row.setKey) ||
        a.row.setKey.localeCompare(b.row.setKey) ||
        a.row.sortIndex - b.row.sortIndex
    );
    const perSet = new Map<string, number>();
    for (const { row } of matches) {
      perSet.set(row.setKey, (perSet.get(row.setKey) ?? 0) + 1);
    }
    return { cards: matches.map(({ row }) => ({ key: row.key, setKey: row.setKey })), perSet };
  });

  /**
   * How many cards each filter value would show, most common first: the
   * cards matching the query and every *other* filter (values within one
   * filter add cards, so a filter's own picks don't narrow its counts).
   * Values with no cards are left out. Without a query or filters, these
   * are the whole catalog's counts.
   */
  readonly counts = computed(() => {
    const cards = this.queryMatches();
    const filters = this._filters();
    const sets = this.sets();
    const owned = this.ownedTest();
    const matching = (except: Partial<SearchFilters>) => {
      const others = { ...filters, ...except };
      return cards.filter((card) =>
        matchesFilters(card, others, sets.get(card.row.setKey)?.seriesKey, owned)
      );
    };
    const tally = (
      matches: IndexedCard[],
      values: (row: CatalogSearchRow, card: IndexedCard) => readonly string[]
    ) => {
      const counts = new Map<string, number>();
      for (const card of matches) {
        for (const value of values(card.row, card)) {
          counts.set(value, (counts.get(value) ?? 0) + 1);
        }
      }
      return counts;
    };
    const sorted = (map: Map<string, number>): FilterCount[] =>
      [...map]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    return {
      categories: sorted(tally(matching({ categories: [] }), categoryValues)),
      types: sorted(tally(matching({ types: [] }), (row) => row.types)),
      rarities: sorted(
        tally(matching({ rarities: [] }), (row) => (row.rarity ? [row.rarity] : []))
      ),
      /** By set key. */
      sets: tally(matching({ series: [], sets: [] }), (row) => [row.setKey]),
      /** By filter value (`illustratorKey`); `filterNames` has their names. */
      illustrators: sorted(
        tally(matching({ illustrators: [] }), (_row, card) =>
          card.illustrator ? [card.illustrator] : []
        )
      ),
    };
  });

  constructor() {
    effect(() => {
      const region = this.region();
      untracked(() => {
        // Sets belong to one catalog (their keys start with it); the other
        // filters apply to both. Picks already for the new catalog stay
        // (`showOnly` picks before switching).
        const ours = (key: string) => key.startsWith(`${region}:`);
        this._filters.update((filters) => ({
          ...filters,
          series: filters.series.filter(ours),
          sets: filters.sets.filter(ours),
        }));
      });
    });
  }

  setQuery(query: string): void {
    this._query.set(query);
    this._active.set(true);
    this.searchChanges.update((count) => count + 1);
  }

  setFilters(filters: SearchFilters): void {
    this._filters.set(filters);
    this._active.set(true);
    this.searchChanges.update((count) => count + 1);
  }

  /**
   * Shows the cards of `region`'s catalog matching `filters` alone, without
   * a query or any other filter: a card detail's Illustrator or Set row
   * (docs/ui.md → Card detail). Switches the catalog (a remembered setting)
   * when the card is from the other one, as a deck's card can be.
   */
  async showOnly(region: CatalogRegion, filters: Partial<SearchFilters>): Promise<void> {
    this._query.set('');
    this.setFilters({ ...NO_FILTERS, ...filters });
    if (region !== this.region()) {
      await this.browse.setRegion(region);
    }
  }

  /** Loads the current catalog's search rows again after a failure. */
  retry(): void {
    this.searchIndex.retry();
  }

  activate(): void {
    if (this.failed()) {
      this.retry();
    }
    this._active.set(true);
    this.searchChanges.update((count) => count + 1);
  }

  /** Hides search, keeping the query and filters (desktop: a set was opened). */
  deactivate(): void {
    this._active.set(false);
  }

  /** Clears the query and filters and hides search (phone: Cancel). */
  exit(): void {
    this._query.set('');
    this._filters.set(NO_FILTERS);
    this._active.set(false);
  }

  /** Remembers the current query (trimmed) as the newest recent search. */
  rememberQuery(): Promise<void> {
    return this.recentSearches.remember(this._query());
  }

  clearRecent(): Promise<void> {
    return this.recentSearches.clear();
  }
}

/** `owned` tells a card's collection status; it's only asked while the Collection filter is used. */
function matchesFilters(
  card: IndexedCard,
  filters: SearchFilters,
  seriesKey: string | undefined,
  owned: (row: CatalogSearchRow) => OwnedValue
): boolean {
  const any = (values: string[], test: (value: string) => boolean) =>
    values.length === 0 || values.some(test);
  const { row } = card;
  const categories = categoryValues(row);
  return (
    any(filters.categories, (value) => categories.includes(value)) &&
    any(filters.types, (type) => row.types.includes(type)) &&
    any(filters.rarities, (rarity) => row.rarity === rarity) &&
    any(filters.illustrators, (illustrator) => card.illustrator === illustrator) &&
    (filters.owned.length === 0 || filters.owned.includes(owned(row))) &&
    (filters.series.length === 0 && filters.sets.length === 0
      ? true
      : filters.sets.includes(row.setKey) ||
        (seriesKey !== undefined && filters.series.includes(seriesKey)))
  );
}
