import { Injectable, computed, inject, signal } from '@angular/core';
import {
  DEFAULT_CATALOG_LANGUAGES,
  DEFAULT_SETTINGS,
  knownCatalogLanguages,
  type CatalogLanguage,
  type CatalogRegion,
  type UserSettings,
} from '@pokepaper/shared';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LocalUserDataRepository } from '../data/local-user-data-repository';
import { SyncService } from './sync.service';

/** Short labels for language buttons, and full names for pickers. */
export const LANGUAGE_LABELS: Readonly<Record<CatalogLanguage, { short: string; name: string }>> = {
  en: { short: 'EN', name: 'English' },
  fr: { short: 'FR', name: 'Français' },
  it: { short: 'IT', name: 'Italiano' },
  de: { short: 'DE', name: 'Deutsch' },
  ja: { short: 'JA', name: '日本語' },
  'zh-tw': { short: '繁中', name: '繁體中文' },
  'zh-cn': { short: '简中', name: '简体中文' },
};

/**
 * The language sets and cards open in: the last one picked in each catalog
 * (international, Asian), synced across devices through user settings.
 */
@Injectable({ providedIn: 'root' })
export class CatalogLanguageService {
  private readonly repository = inject(LocalUserDataRepository);
  private readonly settings = signal<UserSettings>({ ...DEFAULT_SETTINGS });
  /** Picks are saved one at a time, each merged into the stored settings. */
  private saves: Promise<void> = Promise.resolve();
  /** Picks not yet saved: loads meanwhile are dropped (they'd show stale settings). */
  private pending = 0;
  /** Bumped by each pick, so a load that started before it is dropped too. */
  private generation = 0;

  readonly languages = computed<Record<CatalogRegion, CatalogLanguage>>(() => ({
    ...DEFAULT_CATALOG_LANGUAGES,
    ...knownCatalogLanguages(this.settings()),
  }));

  constructor() {
    void this.load();
    inject(SyncService)
      .dataChanged$.pipe(takeUntilDestroyed())
      .subscribe((types) => {
        if (types.has('settings')) {
          void this.load();
        }
      });
  }

  /**
   * The language to show a set in: the catalog's remembered language if the
   * set has it, else the set's first language.
   */
  forSet(region: CatalogRegion, setLanguages: readonly CatalogLanguage[]): CatalogLanguage {
    const remembered = this.languages()[region];
    return setLanguages.includes(remembered) ? remembered : (setLanguages[0] ?? remembered);
  }

  /**
   * Remembers `language` for its catalog: shown at once, then saved locally
   * (and synced). If saving fails, the saved settings are shown again.
   */
  async pick(region: CatalogRegion, language: CatalogLanguage): Promise<void> {
    if (this.languages()[region] === language) {
      return;
    }
    this.generation++;
    this.pending++;
    this.settings.update((current) => withLanguage(current, region, language));
    // Merge into the stored settings, not the in-memory copy, which may not
    // have loaded yet; queued so concurrent picks (either catalog) all land.
    const save = this.saves.then(async () => {
      const next = withLanguage(await this.repository.getSettings(), region, language);
      await this.repository.updateSettings(next);
    });
    this.saves = save.catch(() => undefined);
    try {
      await save;
    } catch (error: unknown) {
      console.error('catalog.language_save_failed', error);
    } finally {
      this.pending--;
      if (this.pending === 0) {
        await this.load(); // What was actually saved (rolls back a failed pick).
      }
    }
  }

  private async load(): Promise<void> {
    const generation = this.generation;
    try {
      const stored = await this.repository.getSettings();
      if (generation === this.generation && this.pending === 0) {
        this.settings.set(stored);
      }
    } catch (error: unknown) {
      console.error('catalog.language_load_failed', error);
    }
  }
}

/** `settings` with `language` remembered for `region` (other entries kept, unknown ones too). */
function withLanguage(
  settings: UserSettings,
  region: CatalogRegion,
  language: CatalogLanguage
): UserSettings {
  return { ...settings, catalogLanguages: { ...settings.catalogLanguages, [region]: language } };
}
