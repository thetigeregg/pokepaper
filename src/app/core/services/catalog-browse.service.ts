import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type { CatalogLanguage, CatalogRegion, CatalogSet } from '@pokepaper/shared';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime } from 'rxjs';
import { catalogKey, type StorageEngine } from '../data/storage-engine';
import { StorageEngineFactory } from '../data/storage-engine.factory';
import { PreferenceStorageService } from '../storage/preference-storage.service';
import { CatalogLanguageService } from './catalog-language.service';
import { CatalogSyncService } from './catalog-sync.service';

/** Preference: the catalog last shown on the Cards tab. */
export const CATALOG_REGION_KEY = 'pokepaper.cards.region';

/** A series and its sets, newest first, named in the catalog's current language. */
export interface SeriesGroup {
  key: string;
  name: string;
  sets: CatalogSet[];
}

/** A localized value in `language`, else the first available. */
export function localized(
  values: Partial<Record<CatalogLanguage, string>>,
  language: CatalogLanguage
): string {
  return values[language] ?? Object.values(values).at(0) ?? '';
}

/**
 * The Cards tab's sets list: which catalog is shown (remembered on this
 * device) and its series and sets, grouped and newest first, kept current
 * as the catalog downloads or updates.
 */
@Injectable({ providedIn: 'root' })
export class CatalogBrowseService {
  private readonly storageEngineFactory = inject(StorageEngineFactory);
  private readonly preferences = inject(PreferenceStorageService);
  private readonly catalogLanguage = inject(CatalogLanguageService);

  private readonly _region = signal<CatalogRegion>('intl');
  readonly region = this._region.asReadonly();
  /** The language the current catalog's names are shown in. */
  readonly language = computed(() => this.catalogLanguage.languages()[this._region()]);

  private readonly series = signal<
    { key: string; names: Partial<Record<CatalogLanguage, string>> }[]
  >([]);
  private readonly sets = signal<CatalogSet[]>([]);
  private readonly _loaded = signal(false);
  readonly loaded = this._loaded.asReadonly();

  readonly groups = computed<SeriesGroup[]>(() => {
    const language = this.language();
    const names = new Map(this.series().map((entry) => [entry.key, entry.names]));
    const groups = new Map<string, SeriesGroup>();
    const newestFirst = [...this.sets()].sort(
      (a, b) =>
        (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '') ||
        localized(a.names, language).localeCompare(localized(b.names, language))
    );
    for (const set of newestFirst) {
      const key = catalogKey(set.region, set.serieId);
      const group = groups.get(key) ?? {
        key,
        name: localized(names.get(key) ?? {}, language) || set.serieId,
        sets: [],
      };
      group.sets.push(set);
      groups.set(key, group);
    }
    return [...groups.values()];
  });

  private get engine(): StorageEngine {
    return this.storageEngineFactory.getEngine();
  }

  constructor() {
    void this.preferences.getItem(CATALOG_REGION_KEY).then((stored) => {
      if (stored === 'intl' || stored === 'asia') {
        this._region.set(stored);
      }
    });
    effect(() => {
      this._region();
      untracked(() => void this.safeReload());
    });
    inject(CatalogSyncService)
      .changed$.pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => void this.safeReload());
  }

  async setRegion(region: CatalogRegion): Promise<void> {
    this._region.set(region);
    await this.preferences.setItem(CATALOG_REGION_KEY, region);
  }

  private async safeReload(): Promise<void> {
    try {
      await this.reload();
    } catch (error: unknown) {
      console.error('catalog.browse_reload_failed', error);
    }
  }

  async reload(): Promise<void> {
    const region = this._region();
    const [series, sets] = await Promise.all([
      this.engine.listCatalogSeries(),
      this.engine.listCatalogSets(region),
    ]);
    if (region !== this._region()) {
      return; // Switched catalogs meanwhile.
    }
    this.series.set(
      series
        .filter((entry) => entry.region === region)
        .map((entry) => ({ key: catalogKey(entry.region, entry.id), names: entry.names }))
    );
    this.sets.set(sets.map((stored) => stored.set));
    this._loaded.set(true);
  }
}
