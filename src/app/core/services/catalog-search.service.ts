import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { CatalogRegion, CatalogSet } from '@pokepaper/shared';
import { debounceTime } from 'rxjs';
import { CATALOG_SEARCH_ROW_VERSION } from '../data/catalog-search-row';
import { catalogKey, type CatalogSearchRow, type StorageEngine } from '../data/storage-engine';
import { StorageEngineFactory } from '../data/storage-engine.factory';
import { PreferenceStorageService } from '../storage/preference-storage.service';
import {
  nameMatches,
  normalizeSearchText,
  prepareName,
  prepareQuery,
  type PreparedName,
} from '../utils/search-text.util';
import { CatalogBrowseService } from './catalog-browse.service';
import { CatalogLanguageService } from './catalog-language.service';
import { CatalogSyncService } from './catalog-sync.service';
import { CollectionService } from './collection.service';

/** Sync metadata: the `CATALOG_SEARCH_ROW_VERSION` the stored search rows were built with. */
export const SEARCH_ROW_VERSION_KEY = 'catalogSearchRowVersion';
/** Preference: recent searches, newest first (JSON array of strings). */
export const RECENT_SEARCHES_KEY = 'pokepaper.cards.recentSearches';
export const MAX_RECENT_SEARCHES = 10;

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

interface IndexedCard {
  row: CatalogSearchRow;
  names: PreparedName[];
}

export function hasFilters(filters: SearchFilters): boolean {
  return Object.values(filters).some((values: string[]) => values.length > 0);
}

/** The card's `category` and, when it has one, `category/subtype`. */
export function categoryValues(row: Pick<CatalogSearchRow, 'category' | 'subtype'>): string[] {
  return row.subtype ? [row.category, `${row.category}/${row.subtype}`] : [row.category];
}

/**
 * Card search for the Cards tab (docs/ui.md → Cards → Search): the query,
 * filters and whether search is showing, the current catalog's search rows
 * held in memory, and the results. Searching never touches storage, so it
 * keeps up with typing; the results page loads the matching cards.
 */
@Injectable({ providedIn: 'root' })
export class CatalogSearchService {
  private readonly storageEngineFactory = inject(StorageEngineFactory);
  private readonly preferences = inject(PreferenceStorageService);
  private readonly browse = inject(CatalogBrowseService);
  private readonly catalogLanguage = inject(CatalogLanguageService);
  private readonly collection = inject(CollectionService);

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

  private readonly _recent = signal<string[]>([]);
  readonly recent = this._recent.asReadonly();

  private readonly index = signal<{ region: CatalogRegion; cards: IndexedCard[] } | null>(null);
  /** Whether the current catalog's search rows have loaded. */
  readonly ready = computed(() => this.index()?.region === this.region());
  /** The current catalog's search rows failed to load (see `retry`). */
  private readonly _failed = signal(false);
  readonly failed = computed(() => this._failed() && !this.ready());

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

  /** Whether a card is owned in the language its set opens in (any variant). */
  private readonly ownedTest = computed(() => {
    const languages = this.setLanguages();
    const fallback = this.catalogLanguage.forSet(this.region(), []);
    return (row: CatalogSearchRow): OwnedValue =>
      this.collection.cardTotal(
        row.region,
        row.key.slice(row.region.length + 1),
        languages.get(row.setKey) ?? fallback
      ) > 0
        ? 'owned'
        : 'missing';
  });

  /** What the current catalog calls its sets and series, for labeling filter picks. */
  readonly setNames = computed(() => ({
    sets: this.sets(),
    seriesNames: this.seriesNames(),
    language: this.language(),
  }));

  readonly seriesNames = computed(
    () => new Map(this.browse.groups().map((group) => [group.key, group.name]))
  );

  /** The current catalog's cards matching the query (all of them without one). */
  private readonly queryMatches = computed<IndexedCard[]>(() => {
    const index = this.index();
    if (!index || index.region !== this.region()) {
      return [];
    }
    const query = prepareQuery(this._query());
    return query
      ? index.cards.filter((card) => card.names.some((name) => nameMatches(name, query)))
      : index.cards;
  });

  readonly results = computed<SearchResults>(() => {
    if (!this.searching()) {
      return { cards: [], perSet: new Map() };
    }
    const filters = this._filters();
    const sets = this.sets();
    const owned = this.ownedTest();
    const matches = this.queryMatches().filter((card) =>
      matchesFilters(card.row, filters, sets.get(card.row.setKey)?.seriesKey, owned)
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
      return cards.filter(({ row }) =>
        matchesFilters(row, others, sets.get(row.setKey)?.seriesKey, owned)
      );
    };
    const tally = (rows: IndexedCard[], values: (row: CatalogSearchRow) => readonly string[]) => {
      const counts = new Map<string, number>();
      for (const { row } of rows) {
        for (const value of values(row)) {
          counts.set(value, (counts.get(value) ?? 0) + 1);
        }
      }
      return counts;
    };
    const sorted = (map: Map<string, number>): FilterCount[] =>
      [...map]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    const ownedCounts = tally(matching({ owned: [] }), (row) => [owned(row)]);
    return {
      categories: sorted(tally(matching({ categories: [] }), categoryValues)),
      types: sorted(tally(matching({ types: [] }), (row) => row.types)),
      rarities: sorted(
        tally(matching({ rarities: [] }), (row) => (row.rarity ? [row.rarity] : []))
      ),
      /** By set key. */
      sets: tally(matching({ series: [], sets: [] }), (row) => [row.setKey]),
      /** Owned and missing cards, both always listed. */
      owned: (['owned', 'missing'] as const).map((value) => ({
        value,
        count: ownedCounts.get(value) ?? 0,
      })),
    };
  });

  private get engine(): StorageEngine {
    return this.storageEngineFactory.getEngine();
  }

  /** Bumped by each load, so an older one finishing late is dropped. */
  private loads = 0;
  private rebuilt: Promise<void> | null = null;
  private recentLoaded: Promise<void> = Promise.resolve();

  constructor() {
    this.recentLoaded = this.loadRecent();
    effect(() => {
      const region = this.region();
      untracked(() => {
        // Sets belong to one catalog; the other filters apply to both.
        this._filters.update((filters) => ({ ...filters, series: [], sets: [] }));
        void this.load(region);
      });
    });
    inject(CatalogSyncService)
      .changed$.pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => void this.load(this.region()));
  }

  setQuery(query: string): void {
    this._query.set(query);
    this._active.set(true);
  }

  setFilters(filters: SearchFilters): void {
    this._filters.set(filters);
    this._active.set(true);
  }

  /** Loads the current catalog's search rows again after a failure. */
  retry(): void {
    void this.load(this.region());
  }

  activate(): void {
    if (this.failed()) {
      this.retry();
    }
    this._active.set(true);
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
  async rememberQuery(): Promise<void> {
    const query = this._query().trim();
    if (!prepareQuery(query)) {
      return;
    }
    await this.recentLoaded; // Else the stored list would be overwritten.
    const normalized = normalizeSearchText(query);
    const recent = [
      query,
      ...this._recent().filter((entry) => normalizeSearchText(entry) !== normalized),
    ].slice(0, MAX_RECENT_SEARCHES);
    this._recent.set(recent);
    await this.saveRecent(recent);
  }

  async clearRecent(): Promise<void> {
    await this.recentLoaded; // Else it would load back afterwards.
    this._recent.set([]);
    await this.saveRecent([]);
  }

  private async load(region: CatalogRegion): Promise<void> {
    const load = ++this.loads;
    this._failed.set(false);
    try {
      this.rebuilt ??= this.rebuildIfStale();
      await this.rebuilt;
      const rows = await this.engine.listCatalogSearchRows(region);
      if (load !== this.loads) {
        return;
      }
      this.index.set({
        region,
        cards: rows.map((row) => ({ row, names: row.names.map(prepareName) })),
      });
    } catch (error: unknown) {
      console.error('catalog.search_load_failed', error);
      if (load === this.loads) {
        this._failed.set(true);
      }
    }
  }

  /**
   * Builds search rows for catalogs stored before they existed (or before
   * `catalogSearchRow()` last changed). Sets downloaded from now on get
   * theirs with the set.
   */
  private async rebuildIfStale(): Promise<void> {
    const version = String(CATALOG_SEARCH_ROW_VERSION);
    try {
      if ((await this.engine.getSyncMeta(SEARCH_ROW_VERSION_KEY))?.value === version) {
        return;
      }
      for (const stored of await this.engine.listCatalogSets()) {
        await this.engine.reindexCatalogSet(stored.region, stored.set.id);
      }
      await this.engine.putSyncMeta({ key: SEARCH_ROW_VERSION_KEY, value: version });
    } catch (error: unknown) {
      this.rebuilt = null; // Try again on the next load.
      throw error;
    }
  }

  private async loadRecent(): Promise<void> {
    try {
      const stored: unknown = JSON.parse(
        (await this.preferences.getItem(RECENT_SEARCHES_KEY)) ?? '[]'
      );
      if (Array.isArray(stored)) {
        this._recent.set(
          stored
            .filter((entry): entry is string => typeof entry === 'string')
            .slice(0, MAX_RECENT_SEARCHES)
        );
      }
    } catch (error: unknown) {
      console.error('catalog.recent_searches_load_failed', error);
    }
  }

  private async saveRecent(recent: string[]): Promise<void> {
    try {
      await this.preferences.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recent));
    } catch (error: unknown) {
      console.error('catalog.recent_searches_save_failed', error);
    }
  }
}

/** `owned` tells a card's collection status; it's only asked while that filter is used. */
function matchesFilters(
  row: CatalogSearchRow,
  filters: SearchFilters,
  seriesKey: string | undefined,
  owned: (row: CatalogSearchRow) => OwnedValue
): boolean {
  const any = (values: string[], test: (value: string) => boolean) =>
    values.length === 0 || values.some(test);
  const categories = categoryValues(row);
  return (
    any(filters.categories, (value) => categories.includes(value)) &&
    any(filters.types, (type) => row.types.includes(type)) &&
    any(filters.rarities, (rarity) => row.rarity === rarity) &&
    (filters.owned.length === 0 || filters.owned.includes(owned(row))) &&
    (filters.series.length === 0 && filters.sets.length === 0
      ? true
      : filters.sets.includes(row.setKey) ||
        (seriesKey !== undefined && filters.series.includes(seriesKey)))
  );
}
