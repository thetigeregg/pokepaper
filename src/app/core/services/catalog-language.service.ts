import { Injectable, computed, inject } from '@angular/core';
import {
  DEFAULT_CATALOG_LANGUAGES,
  knownCatalogLanguages,
  type CatalogLanguage,
  type CatalogRegion,
  type UserSettings,
} from '@pokepaper/shared';
import { UserSettingsService } from './user-settings.service';

/**
 * Labels per language: `short` for badges, `name` everywhere else. Names
 * are always English ("German", not "Deutsch"), in pickers and app text
 * alike (docs/ui.md → Language).
 */
export const LANGUAGE_LABELS: Readonly<Record<CatalogLanguage, { short: string; name: string }>> = {
  en: { short: 'EN', name: 'English' },
  fr: { short: 'FR', name: 'French' },
  it: { short: 'IT', name: 'Italian' },
  de: { short: 'DE', name: 'German' },
  ja: { short: 'JA', name: 'Japanese' },
  'zh-tw': { short: '繁中', name: 'Traditional Chinese' },
  'zh-cn': { short: '简中', name: 'Simplified Chinese' },
};

/** Catalog names, as the Cards tab's catalog segment shows them. */
export const REGION_LABELS: Readonly<Record<CatalogRegion, string>> = {
  intl: 'International',
  asia: 'Japan & Asia',
};

/** The order languages are listed in pickers and app text. */
const LANGUAGE_DISPLAY_ORDER: readonly CatalogLanguage[] = [
  'en',
  'de',
  'fr',
  'it',
  'ja',
  'zh-tw',
  'zh-cn',
];

/** `languages` in display order (English, German, French, Italian, then Asian languages). */
export function inDisplayOrder(languages: readonly CatalogLanguage[]): CatalogLanguage[] {
  return [...languages].sort(
    (a, b) => LANGUAGE_DISPLAY_ORDER.indexOf(a) - LANGUAGE_DISPLAY_ORDER.indexOf(b)
  );
}

/**
 * The language sets and cards open in: the last one picked in each catalog
 * (international, Asian), synced across devices through user settings.
 */
@Injectable({ providedIn: 'root' })
export class CatalogLanguageService {
  private readonly userSettings = inject(UserSettingsService);

  readonly languages = computed<Record<CatalogRegion, CatalogLanguage>>(() => ({
    ...DEFAULT_CATALOG_LANGUAGES,
    ...knownCatalogLanguages(this.userSettings.settings()),
  }));

  /**
   * The language to show a set in: the catalog's remembered language if the
   * set has it, else the set's first language in display order.
   */
  forSet(region: CatalogRegion, setLanguages: readonly CatalogLanguage[]): CatalogLanguage {
    const remembered = this.languages()[region];
    return setLanguages.includes(remembered)
      ? remembered
      : (inDisplayOrder(setLanguages)[0] ?? remembered);
  }

  /**
   * Remembers `language` for its catalog: shown at once, then saved locally
   * (and synced). If saving fails, the saved settings are shown again.
   */
  async pick(region: CatalogRegion, language: CatalogLanguage): Promise<void> {
    if (this.languages()[region] === language) {
      return;
    }
    await this.userSettings.update(
      (settings) => withLanguage(settings, region, language),
      'catalog.language_save_failed'
    );
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
