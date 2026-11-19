import {
  CATALOG_LANGUAGE_REGION,
  CATALOG_LANGUAGES,
  catalogCardImageUrl,
  type CatalogCard,
  type CatalogImageQuality,
  type CatalogLanguage,
  type CatalogRegion,
} from '@pokepaper/shared';

/** `languages` deduplicated, in display order. */
export function inLanguageOrder(languages: Iterable<CatalogLanguage>): CatalogLanguage[] {
  const wanted = new Set(languages);
  return CATALOG_LANGUAGES.filter((language) => wanted.has(language));
}

/** A region's languages in display order. */
export function regionLanguages(region: CatalogRegion): CatalogLanguage[] {
  return CATALOG_LANGUAGES.filter((language) => CATALOG_LANGUAGE_REGION[language] === region);
}

/**
 * The scan to show for `card` in `language`: that language's scan, else the
 * first other language of the card's region that has one (docs/catalog.md).
 * Null when no language has a scan. `language` is the scan's language, so
 * callers can mark a fallback.
 */
export function displayImage(
  card: Pick<CatalogCard, 'region' | 'id' | 'text'>,
  language: CatalogLanguage,
  quality: CatalogImageQuality
): { language: CatalogLanguage; url: string; borrowed: boolean } | null {
  const candidates = [language, ...regionLanguages(card.region).filter((l) => l !== language)];
  const found = candidates.find((candidate) => card.text[candidate]?.image);
  return found
    ? {
        language: found,
        url: catalogCardImageUrl(card, found, quality),
        // Another printing's scan (basic Energy; docs/catalog.md → Basic Energy scans).
        borrowed: !!card.text[found]?.imageFrom,
      }
    : null;
}
