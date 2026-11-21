import type { CardmarketFigures, CatalogCardPrices } from '@pokepaper/shared';

/** Every figure of Cardmarket's price guide TCGdex reports for one finish, in euros. */
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
 * A card's prices as `catalog_prices` stores them: everything TCGdex
 * reports, so clients can be sent more figures later without a refetch.
 * Clients get the subset in `CatalogCardPrices` (`toWirePrices`).
 */
export interface StoredCardPrices {
  /** When TCGdex last read Cardmarket's price guide (ISO timestamp). */
  updated: string;
  /** Cardmarket's product ID. */
  idProduct: number | null;
  /** TCGdex's plain figures: the normal print, or the holo for holo-only cards. */
  base: StoredFigures | null;
  /** TCGdex's `-holo` figures: the reverse holo. */
  reverseHolo: StoredFigures | null;
}

const FIGURES = ['avg', 'low', 'trend', 'avg1', 'avg7', 'avg30'] as const;

/** A Cardmarket product ID: a positive integer. */
function isProductId(value: unknown): value is number {
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
 * Cardmarket prices from a TCGdex card response (`pricing.cardmarket`), or
 * `null` when it has none usable: missing, not in euros, without a valid
 * `updated` time, or without a single figure.
 */
export function parseCardmarketPrices(card: unknown): StoredCardPrices | null {
  if (!isObject(card) || !isObject(card['pricing'])) {
    return null;
  }
  const cardmarket = card['pricing']['cardmarket'];
  if (!isObject(cardmarket) || cardmarket['unit'] !== 'EUR') {
    return null;
  }
  const updatedAt =
    typeof cardmarket['updated'] === 'string' ? Date.parse(cardmarket['updated']) : NaN;
  if (Number.isNaN(updatedAt)) {
    return null;
  }
  const base = figures(cardmarket, '');
  const reverseHolo = figures(cardmarket, '-holo');
  if (!base && !reverseHolo) {
    return null;
  }
  const idProduct = cardmarket['idProduct'];
  return {
    updated: new Date(updatedAt).toISOString(),
    idProduct: isProductId(idProduct) ? idProduct : null,
    base,
    reverseHolo,
  };
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
    base: wireFigures(stored.base),
    reverseHolo: wireFigures(stored.reverseHolo),
  };
}
