import {
  CATALOG_LANGUAGE_REGION,
  CATALOG_REGIONS,
  isCatalogLanguage,
  type CatalogLanguage,
  type CatalogRegion,
} from './catalog';

/**
 * User-level settings, synced between devices as a single entity
 * (`entityType: 'settings'`, `entityId: SETTINGS_ENTITY_ID`).
 */
export interface UserSettings {
  /**
   * Superseded by `catalogLanguages`; kept so payloads written by older
   * clients stay valid. Not read by the app.
   */
  cardLanguage: string;
  /**
   * The language last picked in each catalog, by region (docs/catalog.md):
   * sets and cards open in it. Missing regions use `DEFAULT_CATALOG_LANGUAGES`.
   * May hold regions or languages a newer client added: read it through
   * `knownCatalogLanguages()`, and keep unknown entries when writing.
   */
  catalogLanguages?: Readonly<Record<string, string>>;
}

export const SETTINGS_ENTITY_ID = 'settings';

export const DEFAULT_CATALOG_LANGUAGES: Readonly<Record<CatalogRegion, CatalogLanguage>> = {
  intl: 'en',
  asia: 'ja',
};

export const DEFAULT_SETTINGS: UserSettings = {
  cardLanguage: 'en',
};

/** Bounds for `catalogLanguages` entries (shape only, so newer languages still sync). */
const MAX_CATALOG_LANGUAGE_ENTRIES = 8;
const MAX_CATALOG_LANGUAGE_LENGTH = 16;

/** The `catalogLanguages` entries this build knows: a known region and one of its languages. */
export function knownCatalogLanguages(
  settings: UserSettings
): Partial<Record<CatalogRegion, CatalogLanguage>> {
  const known: Partial<Record<CatalogRegion, CatalogLanguage>> = {};
  for (const [region, language] of Object.entries(settings.catalogLanguages ?? {})) {
    if (
      (CATALOG_REGIONS as readonly string[]).includes(region) &&
      isCatalogLanguage(language) &&
      CATALOG_LANGUAGE_REGION[language] === region
    ) {
      known[region] = language;
    }
  }
  return known;
}

/** Runtime shape check for settings payloads (used by the server to validate pushes). */
export function isUserSettings(value: unknown): value is UserSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const { cardLanguage, catalogLanguages } = value as Record<string, unknown>;
  if (typeof cardLanguage !== 'string' || cardLanguage.length === 0 || cardLanguage.length > 16) {
    return false;
  }
  if (catalogLanguages === undefined) {
    return true;
  }
  if (
    typeof catalogLanguages !== 'object' ||
    catalogLanguages === null ||
    Array.isArray(catalogLanguages)
  ) {
    return false;
  }
  // Shape only: a newer client may know regions or languages this one doesn't
  // (`knownCatalogLanguages` ignores them), and rejecting them would stop
  // that device's settings from syncing at all.
  const entries = Object.entries(catalogLanguages);
  return (
    entries.length <= MAX_CATALOG_LANGUAGE_ENTRIES &&
    entries.every(
      ([region, language]) =>
        region.length > 0 &&
        region.length <= MAX_CATALOG_LANGUAGE_LENGTH &&
        typeof language === 'string' &&
        language.length > 0 &&
        language.length <= MAX_CATALOG_LANGUAGE_LENGTH
    )
  );
}
