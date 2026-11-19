import { deckCardKey, type Deck } from '@pokepaper/shared';
import type { CheckedCard } from './deck-rules';

/**
 * Owned vs. needed (docs/decks.md): how many of each deck card the
 * collection covers. A card is covered by copies of any identical printing
 * (same English name and rules text), in any language and variant; copies
 * are shared across the deck's slots, so none is counted twice.
 */

export interface SlotOwned {
  /** Copies covered, at most the slot's count. */
  owned: number;
  /** How many of `owned` are copies of another printing. */
  fromOther: number;
  /** Copies still needed. */
  missing: number;
}

export interface DeckOwned {
  /** By deck slot key; cards not on this device are left out. */
  slots: ReadonlyMap<string, SlotOwned>;
  /** Copies needed across the deck (cards on this device). */
  missing: number;
}

/**
 * Covers each slot with copies of its own printing first, then (in deck
 * order) with what's left of its identical printings.
 */
export function ownedCoverage(
  deck: Pick<Deck, 'cards'>,
  cards: ReadonlyMap<string, CheckedCard>,
  copies: (cardKey: string) => number
): DeckOwned {
  // Slots grouped by identical printings (each slot's printings include its own).
  const groups = new Map<
    string,
    { printings: readonly string[]; slots: { key: string; count: number }[] }
  >();
  for (const slot of deck.cards) {
    const key = deckCardKey(slot);
    const checked = cards.get(key);
    if (!checked) {
      continue;
    }
    const id = [...checked.printings].sort().join('\n');
    const group = groups.get(id) ?? { printings: checked.printings, slots: [] };
    group.slots.push({ key, count: slot.count });
    groups.set(id, group);
  }

  const slots = new Map<string, SlotOwned>();
  let missing = 0;
  for (const group of groups.values()) {
    let left = group.printings.reduce((total, printing) => total + copies(printing), 0);
    const own = new Map<string, number>();
    for (const { key, count } of group.slots) {
      const taken = Math.min(count, copies(key));
      own.set(key, taken);
      left -= taken;
    }
    for (const { key, count } of group.slots) {
      const exact = own.get(key) ?? 0;
      const fromOther = Math.min(count - exact, Math.max(left, 0));
      left -= fromOther;
      const owned = exact + fromOther;
      slots.set(key, { owned, fromOther, missing: count - owned });
      missing += count - owned;
    }
  }
  return { slots, missing };
}
