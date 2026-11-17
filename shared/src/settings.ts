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
   * The language last picked in each catalog (docs/catalog.md): sets and
   * cards open in it. Missing regions use `DEFAULT_CATALOG_LANGUAGES`.
   */
  catalogLanguages?: Partial<Record<CatalogRegion, CatalogLanguage>>;
}

export const SETTINGS_ENTITY_ID = 'settings';

export const DEFAULT_CATALOG_LANGUAGES: Readonly<Record<CatalogRegion, CatalogLanguage>> = {
  intl: 'en',
  asia: 'ja',
};

export const DEFAULT_SETTINGS: UserSettings = {
  cardLanguage: 'en',
};

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
  return Object.entries(catalogLanguages).every(
    ([region, language]) =>
      (CATALOG_REGIONS as readonly string[]).includes(region) &&
      isCatalogLanguage(language) &&
      CATALOG_LANGUAGE_REGION[language] === region
  );
}
