import { deckCardKey, type Deck, type DeckCard } from '@pokepaper/shared';
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
  /**
   * The Considering pile's cards, by slot key, covered by copies the deck
   * doesn't use (spare copies); cards not on this device are left out.
   */
  considering: ReadonlyMap<string, SlotOwned>;
  /** Copies needed across the deck (cards on this device). */
  missing: number;
  /** Copies of cards not on this device, so not compared with the collection. */
  unknown: number;
}

/**
 * Covers each slot with copies of its own printing first, then (in deck
 * order) with what's left of its identical printings. Slots whose printings
 * overlap at all share one pool, so a copy can only ever cover one card.
 * The Considering pile is covered the same way from what the deck leaves.
 */
export function ownedCoverage(
  deck: Pick<Deck, 'cards' | 'considering'>,
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

  /** Tier 0 is the deck, tier 1 its Considering pile, covered after it. */
  type Known = { tier: 0 | 1; key: string; count: number; printings: readonly string[] };
  const known: Known[] = [];
  let unknown = 0;
  const lists: [0 | 1, readonly DeckCard[]][] = [
    [0, deck.cards],
    [1, deck.considering ?? []],
  ];
  for (const [tier, slots] of lists) {
    for (const slot of slots) {
      const key = deckCardKey(slot);
      const checked = cards.get(key);
      if (!checked) {
        if (tier === 0) {
          unknown += slot.count;
        }
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
      known.push({ tier, key, count: slot.count, printings });
    }
  }

  const groups = new Map<string, { printings: Set<string>; slots: Known[] }>();
  for (const slot of known) {
    const root = find(slot.key);
    const group = groups.get(root) ?? { printings: new Set<string>(), slots: [] };
    slot.printings.forEach((printing) => group.printings.add(printing));
    group.slots.push(slot);
    groups.set(root, group);
  }

  const slots = new Map<string, SlotOwned>();
  const considering = new Map<string, SlotOwned>();
  let missing = 0;
  for (const group of groups.values()) {
    /** Copies of each printing still free to cover a slot. */
    const free = new Map([...group.printings].map((printing) => [printing, copies(printing)]));
    const take = (printing: string, wanted: number): number => {
      const taken = Math.min(wanted, free.get(printing) ?? 0);
      free.set(printing, (free.get(printing) ?? 0) - taken);
      return taken;
    };
    for (const tier of [0, 1] as const) {
      const tierSlots = group.slots.filter((slot) => slot.tier === tier);
      const own = new Map(tierSlots.map(({ key, count }) => [key, take(key, count)]));
      for (const { key, count } of tierSlots) {
        const exact = own.get(key) ?? 0;
        let fromOther = 0;
        for (const printing of group.printings) {
          if (exact + fromOther === count) {
            break;
          }
          fromOther += take(printing, count - exact - fromOther);
        }
        const owned = exact + fromOther;
        const result = { owned, fromOther, missing: count - owned };
        if (tier === 0) {
          slots.set(key, result);
          missing += count - owned;
        } else {
          considering.set(key, result);
        }
      }
    }
  }
  return { slots, considering, missing, unknown };
}
