import {
  CATALOG_REGIONS,
  type CardmarketFigures,
  type CatalogCardPrices,
  type CatalogRegion,
  type CollectionEntry,
  type CollectionVariant,
} from '@pokepaper/shared';
import { catalogKey } from '../data/storage-engine';

/**
 * The price shown for a finish (docs/catalog.md → Prices): Cardmarket's
 * trend, else the 30-day average; null when it has neither.
 */
export function headlinePrice(figures: CardmarketFigures): number | null {
  return figures.trend ?? figures.avg30;
}

/**
 * The figures a copy in `variant` is valued by: normal and holo copies by
 * the base finish (Cardmarket prices a holo-only card as its base product),
 * reverse holos by the reverse holo. First edition and W promo copies (and
 * variants this build doesn't know) have no Cardmarket figures of their own.
 */
export function variantFigures(
  prices: CatalogCardPrices,
  variant: CollectionVariant | (string & {})
): CardmarketFigures | null {
  switch (variant) {
    case 'normal':
    case 'holo':
      return prices.base;
    case 'reverse':
      return prices.reverseHolo;
    default:
      return null;
  }
}

/** One catalog's collection value (docs/collection.md → Value). */
export interface CatalogValue {
  region: CatalogRegion;
  /** Copies owned, in every language and variant. */
  copies: number;
  /** Copies without a price: not priced by Cardmarket, or in a variant it doesn't price. */
  unpriced: number;
  /** Euros, summed in cents. */
  value: number;
  /** The newest price used (ISO timestamp), or null when none was. */
  updated: string | null;
}

/**
 * The value of each catalog's copies, in every language, by Cardmarket
 * prices keyed `region:cardId`. Catalogs without copies are left out.
 */
export function collectionValue(
  entries: readonly (CollectionEntry & { region: CatalogRegion })[],
  prices: ReadonlyMap<string, CatalogCardPrices>
): CatalogValue[] {
  const totals = new Map<CatalogRegion, CatalogValue & { cents: number }>();
  for (const entry of entries) {
    const total = totals.get(entry.region) ?? {
      region: entry.region,
      copies: 0,
      unpriced: 0,
      value: 0,
      cents: 0,
      updated: null,
    };
    totals.set(entry.region, total);
    total.copies += entry.quantity;
    const cardPrices = prices.get(catalogKey(entry.region, entry.cardId));
    const figures = cardPrices ? variantFigures(cardPrices, entry.variant) : null;
    const price = figures ? headlinePrice(figures) : null;
    if (!cardPrices || price === null) {
      total.unpriced += entry.quantity;
      continue;
    }
    total.cents += Math.round(price * 100) * entry.quantity;
    if (total.updated === null || cardPrices.updated > total.updated) {
      total.updated = cardPrices.updated;
    }
  }
  return CATALOG_REGIONS.flatMap((region) => {
    const total = totals.get(region);
    if (!total) {
      return [];
    }
    const { cents, ...value } = total;
    return [{ ...value, value: cents / 100 }];
  });
}
