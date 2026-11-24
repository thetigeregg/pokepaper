import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { CatalogRegion } from '@pokepaper/shared';
import { debounceTime } from 'rxjs';
import { CATALOG_SEARCH_ROW_VERSION } from '../data/catalog-search-row';
import type { CatalogSearchRow, StorageEngine } from '../data/storage-engine';
import { StorageEngineFactory } from '../data/storage-engine.factory';
import {
  parseCardNumber,
  prepareName,
  type CardNumber,
  type PreparedName,
} from '../utils/search-text.util';
import { CatalogBrowseService } from './catalog-browse.service';
import { CatalogSyncService } from './catalog-sync.service';

/** Sync metadata: the `CATALOG_SEARCH_ROW_VERSION` the stored search rows were built with. */
export const SEARCH_ROW_VERSION_KEY = 'catalogSearchRowVersion';

/** A card's search row with its names and number prepared for matching. */
export interface IndexedCard {
  row: CatalogSearchRow;
  names: PreparedName[];
  number: CardNumber | null;
}

/**
 * The current catalog's search rows, held in memory once for every search
 * screen (each has its own `CatalogSearchService`): a whole catalog's rows
 * are too many to keep a copy per screen. Reloads when the catalog is
 * switched or updated.
 */
@Injectable({ providedIn: 'root' })
export class CatalogSearchIndexService {
  private readonly storageEngineFactory = inject(StorageEngineFactory);
  private readonly browse = inject(CatalogBrowseService);

  private readonly index = signal<{ region: CatalogRegion; cards: IndexedCard[] } | null>(null);
  /** The current catalog's cards, or none until they've loaded. */
  readonly cards = computed<IndexedCard[]>(() => {
    const index = this.index();
    return index?.region === this.browse.region() ? index.cards : [];
  });
  /** Whether the current catalog's search rows have loaded. */
  readonly ready = computed(() => this.index()?.region === this.browse.region());
  /** The current catalog's search rows failed to load (see `retry`). */
  private readonly _failed = signal(false);
  readonly failed = computed(() => this._failed() && !this.ready());

  /** Bumped by each load, so an older one finishing late is dropped. */
  private loads = 0;
  private rebuilt: Promise<void> | null = null;

  constructor() {
    effect(() => {
      const region = this.browse.region();
      untracked(() => void this.load(region));
    });
    inject(CatalogSyncService)
      .changed$.pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => void this.load(this.browse.region()));
  }

  /** Loads the current catalog's search rows again after a failure. */
  retry(): void {
    void this.load(this.browse.region());
  }

  private get engine(): StorageEngine {
    return this.storageEngineFactory.getEngine();
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
        cards: rows.map((row) => ({
          row,
          names: row.names.map(prepareName),
          // A row an older version wrote (another tab) just isn't searchable by number.
          number: parseCardNumber(row.number ?? ''),
        })),
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
}
