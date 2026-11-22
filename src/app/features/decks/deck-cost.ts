import { deckCardKey, type CatalogCardPrices, type DeckCard } from '@pokepaper/shared';
import { headlinePrice } from '../../core/utils/catalog-price.util';
import type { DeckOwned } from './deck-owned';

/**
 * A deck slot's price in euros: slots are printings without a variant, so
 * the base finish (the normal print, or the holo for holo-only cards), else
 * the reverse holo when that's all Cardmarket prices. Null without either.
 */
export function slotPrice(prices: CatalogCardPrices | undefined): number | null {
  if (!prices) {
    return null;
  }
  const base = prices.base ? headlinePrice(prices.base) : null;
  return base ?? (prices.reverseHolo ? headlinePrice(prices.reverseHolo) : null);
}

/** What the copies a deck still needs cost (docs/decks.md → Cost to complete). */
export interface CostToComplete {
  /** Euros, summed in cents. */
  euros: number;
  /** Copies still needed. */
  copies: number;
  /** How many of `copies` have no price. */
  unpriced: number;
}

/**
 * What the copies of `cards` (the deck, not its Considering pile) that
 * `owned` says are still needed cost at `prices` (keyed `region:cardId`).
 * Cards not on this device aren't compared, so they aren't counted.
 */
export function costToComplete(
  cards: readonly DeckCard[],
  prices: ReadonlyMap<string, CatalogCardPrices>,
  owned: DeckOwned
): CostToComplete {
  let cents = 0;
  let copies = 0;
  let unpriced = 0;
  for (const card of cards) {
    const key = deckCardKey(card);
    const missing = owned.slots.get(key)?.missing ?? 0;
    if (missing === 0) {
      continue;
    }
    copies += missing;
    const price = slotPrice(prices.get(key));
    if (price === null) {
      unpriced += missing;
    } else {
      cents += Math.round(price * 100) * missing;
    }
  }
  return { euros: cents / 100, copies, unpriced };
}
