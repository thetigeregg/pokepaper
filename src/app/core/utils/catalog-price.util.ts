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

type ReverseHoloFields = Pick<CatalogCard, 'rarity' | 'suffix' | 'variants' | 'tcgplayerFinishes'>;

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

/** What a set's cards tell about its reverse holos (`setReverseHolos`). */
export interface SetReverseHolos {
  /** TCGdex keeps the set's reverse holo flags (`flagsReverseHolos`). */
  tcgdexFlags: boolean;
  /** TCGplayer sells some card of the set in reverse holo (`tcgplayerFinishes`). */
  tcgplayerSells: boolean;
}

/** What `reverseHoloPossible` needs to know of a card's set, from its cards. */
export function setReverseHolos(cards: readonly ReverseHoloFields[]): SetReverseHolos {
  return {
    tcgdexFlags: flagsReverseHolos(cards),
    tcgplayerSells: cards.some((card) => card.tcgplayerFinishes?.reverse === true),
  };
}

/** For a set whose cards couldn't be read: the reverse holo goes by the card alone. */
export const UNKNOWN_SET_REVERSE_HOLOS: SetReverseHolos = {
  tcgdexFlags: false,
  tcgplayerSells: true,
};

/**
 * Numbers of special subsets printed without reverse holos: Radiant
 * Collection (RC), Trainer Gallery (TG), Galarian Gallery (GG).
 */
const SUBSET_WITHOUT_REVERSE_HOLOS = /^(RC|TG|GG)\d/;
/** Black Star Promos and other promo sets: their cards come one way each. */
const PROMO_SET_NAME = /\bPromos?\b/;

/** What `reverseHoloPossible` reads of a card. */
export type ReverseHoloCard = ReverseHoloFields &
  Pick<CatalogCard, 'region' | 'localId' | 'text' | 'tcgplayerFinishes'>;
/** What `reverseHoloPossible` reads of a set. */
export type ReverseHoloSet = Pick<CatalogSet, 'releaseDate' | 'names'>;

/**
 * Whether `card` can come in reverse holo, as far as the catalog tells
 * (docs/catalog.md → Reverse holo figures), in this order:
 *
 * - Never in a set from before reverse holos, whatever TCGdex flags.
 * - Always when TCGdex flags it.
 * - Never in a set whose flags TCGdex keeps (`setHolos.tcgdexFlags`), nor
 *   in the Japan & Asia catalog: TCGdex flags the few sets with mirror
 *   holos, and the rarities don't mean the same there.
 * - Always when TCGplayer sells it in reverse holo (`tcgplayerFinishes`).
 * - Never when TCGplayer lists its finishes but sells no card of its set in
 *   reverse holo (`setHolos.tcgplayerSells`): POP Series, Dragon Vault,
 *   Celebrations. In a set with reverse holos, a missing entry may just be
 *   one TCGplayer lacks (a new set's uncommon), so the rule below decides.
 * - Otherwise when it's plain (no suffix) and of a rarity printed in
 *   reverse holo, unless it's a Prism Star (◇), in a subset printed without
 *   them (`SUBSET_WITHOUT_REVERSE_HOLOS`) or in a promo set.
 */
export function reverseHoloPossible(
  card: ReverseHoloCard,
  set: ReverseHoloSet,
  setHolos: SetReverseHolos
): boolean {
  if (beforeReverseHolos(set)) {
    return false;
  }
  if (card.variants.reverse) {
    return true;
  }
  if (setHolos.tcgdexFlags || card.region !== 'intl') {
    return false;
  }
  if (card.tcgplayerFinishes?.reverse) {
    return true;
  }
  if (card.tcgplayerFinishes && !setHolos.tcgplayerSells) {
    return false;
  }
  return (
    card.suffix === null &&
    card.rarity !== null &&
    REVERSE_HOLO_RARITIES.has(card.rarity) &&
    !Object.values(card.text).some((text) => text.name.includes('◇')) &&
    !SUBSET_WITHOUT_REVERSE_HOLOS.test(card.localId) &&
    !Object.values(set.names).some((name) => PROMO_SET_NAME.test(name))
  );
}

/**
 * A trend this many times off the 30-day average, either way, is taken for
 * an error: Cardmarket reports €0.02 for some cards that sell for over
 * €100 (Team Rocket's Dark Gyarados), and a few trends far above anything
 * sold.
 */
export const TREND_OUTLIER_FACTOR = 10;

/**
 * The price shown for a finish (docs/catalog.md → Prices): Cardmarket's
 * trend, else the 30-day average, which also stands in for a trend
 * `TREND_OUTLIER_FACTOR` times off it; null when it has neither.
 */
export function headlinePrice(figures: CardmarketFigures): number | null {
  const { trend, avg30 } = figures;
  if (trend === null) {
    return avg30;
  }
  const outlier =
    avg30 !== null &&
    avg30 > 0 &&
    (trend * TREND_OUTLIER_FACTOR < avg30 || trend > avg30 * TREND_OUTLIER_FACTOR);
  return outlier ? avg30 : trend;
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
