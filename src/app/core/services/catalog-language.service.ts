import { Injectable, computed, inject, signal } from '@angular/core';
import {
  DEFAULT_CATALOG_LANGUAGES,
  DEFAULT_SETTINGS,
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

  readonly languages = computed<Record<CatalogRegion, CatalogLanguage>>(() => ({
    ...DEFAULT_CATALOG_LANGUAGES,
    ...this.settings().catalogLanguages,
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

  /** Remembers `language` for its catalog (saved locally, then synced). */
  async pick(region: CatalogRegion, language: CatalogLanguage): Promise<void> {
    const current = this.settings();
    if (this.languages()[region] === language) {
      return;
    }
    const next: UserSettings = {
      ...current,
      catalogLanguages: { ...current.catalogLanguages, [region]: language },
    };
    this.settings.set(next);
    await this.repository.updateSettings(next);
  }

  private async load(): Promise<void> {
    this.settings.set(await this.repository.getSettings());
  }
}
