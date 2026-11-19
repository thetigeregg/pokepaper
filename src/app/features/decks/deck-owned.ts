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
  /** Copies of cards not on this device, so not compared with the collection. */
  unknown: number;
}

/**
 * Covers each slot with copies of its own printing first, then (in deck
 * order) with what's left of its identical printings. Slots whose printings
 * overlap at all share one pool, so a copy can only ever cover one card.
 */
export function ownedCoverage(
  deck: Pick<Deck, 'cards'>,
  cards: ReadonlyMap<string, CheckedCard>,
  copies: (cardKey: string) => number
): DeckOwned {
  // Union-find over printing keys: slots sharing any printing end up together.
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    for (
      let next = parent.get(root);
      next !== undefined && next !== root;
      next = parent.get(root)
    ) {
      root = next;
    }
    parent.set(key, root);
    return root;
  };
  const union = (a: string, b: string) => {
    parent.set(find(a), find(b));
  };

  const known: { key: string; count: number; printings: readonly string[] }[] = [];
  let unknown = 0;
  for (const slot of deck.cards) {
    const key = deckCardKey(slot);
    const checked = cards.get(key);
    if (!checked) {
      unknown += slot.count;
      continue;
    }
    const printings = checked.printings.includes(key)
      ? checked.printings
      : [key, ...checked.printings];
    for (const printing of printings) {
      if (!parent.has(printing)) {
        parent.set(printing, printing); // The slot's own key is among them, so set before any union.
      }
    }
    for (const printing of printings) {
      union(printing, key);
    }
    known.push({ key, count: slot.count, printings });
  }

  const groups = new Map<
    string,
    { printings: Set<string>; slots: { key: string; count: number }[] }
  >();
  for (const slot of known) {
    const root = find(slot.key);
    const group = groups.get(root) ?? { printings: new Set<string>(), slots: [] };
    slot.printings.forEach((printing) => group.printings.add(printing));
    group.slots.push({ key: slot.key, count: slot.count });
    groups.set(root, group);
  }

  const slots = new Map<string, SlotOwned>();
  let missing = 0;
  for (const group of groups.values()) {
    let left = [...group.printings].reduce((total, printing) => total + copies(printing), 0);
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
  return { slots, missing, unknown };
}
