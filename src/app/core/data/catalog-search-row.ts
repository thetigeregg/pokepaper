import type { CatalogCard } from '@pokepaper/shared';
import { normalizeSearchText } from '../utils/search-text.util';
import { catalogKey, type CatalogSearchRow } from './storage-engine';

/**
 * Bumped whenever `catalogSearchRow()` changes what it stores, so stored rows
 * are rebuilt (`CatalogSearchService`).
 */
export const CATALOG_SEARCH_ROW_VERSION = 1;

/** A card's search row (see `CatalogSearchRow`), for the set it's stored under. */
export function catalogSearchRow(card: CatalogCard, setKey: string): CatalogSearchRow {
  const names = new Set<string>();
  for (const text of Object.values(card.text)) {
    const name = normalizeSearchText(text.name);
    if (name) {
      names.add(name);
    }
  }
  return {
    key: catalogKey(card.region, card.id),
    region: card.region,
    setKey,
    sortIndex: card.sortIndex,
    names: [...names],
    category: card.category,
    subtype: card.trainerType ?? card.energyType,
    rarity: card.rarity,
    types: card.types,
  };
}
