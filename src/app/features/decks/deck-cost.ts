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

/** What a set of copies costs in euros (summed in cents), and how many have no price. */
export interface CostTotal {
  euros: number;
  unpriced: number;
}

/** Deck cost (docs/decks.md → Cost): the whole deck, and the copies still needed. */
export interface DeckCost {
  deck: CostTotal;
  /** The copies the collection doesn't cover (cards on this device); null until compared. */
  toComplete: (CostTotal & { copies: number }) | null;
}

/**
 * The cost of `cards` (the deck, not its Considering pile) at `prices`
 * (keyed `region:cardId`), and of the copies `owned` says are still needed.
 */
export function deckCost(
  cards: readonly DeckCard[],
  prices: ReadonlyMap<string, CatalogCardPrices>,
  owned: DeckOwned | undefined
): DeckCost {
  const deck = { cents: 0, unpriced: 0 };
  const needed = { cents: 0, unpriced: 0, copies: 0 };
  for (const card of cards) {
    const key = deckCardKey(card);
    const price = slotPrice(prices.get(key));
    const cents = price === null ? null : Math.round(price * 100);
    add(deck, cents, card.count);
    const missing = owned?.slots.get(key)?.missing ?? 0;
    if (missing > 0) {
      needed.copies += missing;
      add(needed, cents, missing);
    }
  }
  return {
    deck: { euros: deck.cents / 100, unpriced: deck.unpriced },
    toComplete: owned
      ? { euros: needed.cents / 100, unpriced: needed.unpriced, copies: needed.copies }
      : null,
  };
}

function add(
  total: { cents: number; unpriced: number },
  cents: number | null,
  copies: number
): void {
  if (cents === null) {
    total.unpriced += copies;
  } else {
    total.cents += cents * copies;
  }
}
