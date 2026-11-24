import type { CardmarketFigures, CatalogCardPrices } from '@pokepaper/shared';

/** Every figure of Cardmarket's price guide for one finish, in euros. */
export interface StoredFigures {
  /** Average sale price. */
  avg: number | null;
  /** Lowest current listing, in any condition or language. */
  low: number | null;
  trend: number | null;
  /** Average sale price over the last 1, 7 and 30 days. */
  avg1: number | null;
  avg7: number | null;
  avg30: number | null;
}

/**
 * A card's prices as `catalog_prices` stores them: every figure of
 * Cardmarket's price guide, so clients can be sent more figures later
 * without a refetch. Clients get the subset in `CatalogCardPrices`
 * (`toWirePrices`).
 */
export interface StoredCardPrices {
  /** When Cardmarket generated the price guide (ISO timestamp). */
  updated: string;
  /** Cardmarket's product ID. */
  idProduct: number | null;
  /** The plain figures: the normal print, or the holo for holo-only cards. */
  base: StoredFigures | null;
  /** The `-holo` figures: the reverse holo. */
  reverseHolo: StoredFigures | null;
  /** `idProduct` was matched by hand (`cardmarket_matches`), not reported by TCGdex. */
  matchedByHand?: true;
}

const FIGURES = ['avg', 'low', 'trend', 'avg1', 'avg7', 'avg30'] as const;

/** A Cardmarket product ID: a positive integer. */
export function isProductId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
/** Anything above this is a data error, not a price. */
const MAX_PRICE = 10_000_000;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A price in euros. Cardmarket reports "no data" as 0, so only positive numbers count. */
function price(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_PRICE
    ? value
    : null;
}

function figures(record: Json, suffix: '' | '-holo'): StoredFigures | null {
  const result = Object.fromEntries(
    FIGURES.map((name) => [name, price(record[`${name}${suffix}`])])
  ) as unknown as StoredFigures;
  return FIGURES.some((name) => result[name] !== null) ? result : null;
}

/**
 * A card's Cardmarket product ID from a TCGdex card response
 * (`pricing.cardmarket.idProduct`), or null when it has none.
 */
export function parseProductId(card: unknown): number | null {
  if (!isObject(card) || !isObject(card['pricing'])) {
    return null;
  }
  const cardmarket = card['pricing']['cardmarket'];
  return isObject(cardmarket) && isProductId(cardmarket['idProduct'])
    ? cardmarket['idProduct']
    : null;
}

/**
 * A product's prices from one entry of Cardmarket's price guide download
 * (`priceGuides[]`: `idProduct`, `trend`, `avg30`, …, `trend-holo`, … in
 * euros), stamped with the guide's `updated` time. Null when the entry isn't
 * one or has no usable figure.
 */
export function parseGuideEntry(entry: unknown, updated: string): StoredCardPrices | null {
  if (!isObject(entry) || !isProductId(entry['idProduct'])) {
    return null;
  }
  const base = figures(entry, '');
  const reverseHolo = figures(entry, '-holo');
  if (!base && !reverseHolo) {
    return null;
  }
  return { updated, idProduct: entry['idProduct'], base, reverseHolo };
}

function wireFigures(stored: StoredFigures | null): CardmarketFigures | null {
  if (!stored || (stored.trend === null && stored.avg7 === null && stored.avg30 === null)) {
    return null;
  }
  return { trend: stored.trend, avg7: stored.avg7, avg30: stored.avg30 };
}

/** The figures clients get (`CatalogPricePack`). */
export function toWirePrices(stored: StoredCardPrices): CatalogCardPrices {
  return {
    updated: stored.updated,
    ...(isProductId(stored.idProduct) && { idProduct: stored.idProduct }),
    ...(stored.matchedByHand && { matchedByHand: true as const }),
    base: wireFigures(stored.base),
    reverseHolo: wireFigures(stored.reverseHolo),
  };
}
