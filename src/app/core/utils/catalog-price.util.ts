import {
  CATALOG_REGIONS,
  type CardmarketFigures,
  type CatalogCard,
  type CatalogCardPrices,
  type CatalogRegion,
  type CatalogSet,
  type CollectionEntry,
  type CollectionVariant,
} from '@pokepaper/shared';
import { catalogKey } from '../data/storage-engine';

/**
 * Reverse holos began with Legendary Collection (May 2002). Cardmarket
 * reports reverse holo figures for some older cards too, and TCGdex flags
 * a few as reverse holos, neither matching any printing (docs/catalog.md →
 * Reverse holo figures).
 */
export const FIRST_REVERSE_HOLO_DATE = '2002-05-24';

/** Whether a set came out before reverse holos existed (`FIRST_REVERSE_HOLO_DATE`). */
export function beforeReverseHolos(set: Pick<CatalogSet, 'releaseDate'>): boolean {
  return set.releaseDate !== null && set.releaseDate < FIRST_REVERSE_HOLO_DATE;
}

/**
 * The rarities printed in reverse holo, for sets whose TCGdex flags can't
 * tell (`reverseHoloPossible`). Never Ultra or Secret Rares or promos, nor
 * EX, GX, V, ex and the like, which have a suffix.
 */
const REVERSE_HOLO_RARITIES: ReadonlySet<string> = new Set([
  'Common',
  'Uncommon',
  'Rare',
  'Holo Rare',
  'Rare Holo',
]);

type ReverseHoloFields = Pick<CatalogCard, 'rarity' | 'suffix' | 'variants'>;

/**
 * Whether TCGdex keeps a set's reverse holo flags: most of its plain
 * (no suffix) commons and uncommons are flagged. One flag isn't enough:
 * whole sets lack them (every XY set) and some have one card flagged out
 * of a hundred (Forbidden Light). Docs: docs/catalog.md → Reverse holo figures.
 */
export function flagsReverseHolos(cards: readonly ReverseHoloFields[]): boolean {
  const plain = cards.filter(
    (card) => (card.rarity === 'Common' || card.rarity === 'Uncommon') && card.suffix === null
  );
  return plain.filter((card) => card.variants.reverse).length * 2 > plain.length;
}

/**
 * Whether `card` can come in reverse holo, as far as the catalog tells:
 * never in a set from before reverse holos (whatever TCGdex flags), always
 * when TCGdex flags it, never in a set whose flags TCGdex keeps (`setFlagsReverseHolos`, from
 * `flagsReverseHolos`), and otherwise, in the international catalog, when
 * it's plain (no suffix) and of a rarity printed in reverse holo. In the
 * Japan & Asia catalog only flagged cards do: TCGdex flags the few sets
 * with mirror holos, and the rarities don't mean the same there.
 */
export function reverseHoloPossible(
  card: ReverseHoloFields & Pick<CatalogCard, 'region'>,
  set: Pick<CatalogSet, 'releaseDate'>,
  setFlagsReverseHolos: boolean
): boolean {
  if (beforeReverseHolos(set)) {
    return false;
  }
  if (card.variants.reverse) {
    return true;
  }
  return (
    card.region === 'intl' &&
    !setFlagsReverseHolos &&
    card.suffix === null &&
    card.rarity !== null &&
    REVERSE_HOLO_RARITIES.has(card.rarity)
  );
}

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
 * reverse holos by the reverse holo, except in a set from before reverse
 * holos (`beforeReverseHolos`), where the copy TCGdex flags as one is
 * valued by the base finish too. First edition and W promo copies (and
 * variants this build doesn't know) have no Cardmarket figures of their own.
 */
export function variantFigures(
  prices: CatalogCardPrices,
  variant: CollectionVariant | (string & {}),
  setBeforeReverseHolos = false
): CardmarketFigures | null {
  switch (variant) {
    case 'normal':
    case 'holo':
      return prices.base;
    case 'reverse':
      return setBeforeReverseHolos ? prices.base : prices.reverseHolo;
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
 * prices keyed `region:cardId`. `setsBeforeReverseHolos` holds the sets
 * (keyed `region:setId`) from before reverse holos (`variantFigures`).
 * Catalogs without copies are left out.
 */
export function collectionValue(
  entries: readonly (CollectionEntry & { region: CatalogRegion })[],
  prices: ReadonlyMap<string, CatalogCardPrices>,
  setsBeforeReverseHolos: ReadonlySet<string> = new Set()
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
    const figures = cardPrices
      ? variantFigures(
          cardPrices,
          entry.variant,
          setsBeforeReverseHolos.has(catalogKey(entry.region, entry.setId))
        )
      : null;
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
