import type { CatalogCardPrices, DeckCard } from '@pokepaper/shared';
import { deckCost, slotPrice } from './deck-cost';
import type { DeckOwned, SlotOwned } from './deck-owned';

const prices = (base: number | null, reverseHolo: number | null = null): CatalogCardPrices => ({
  updated: '2026-11-22T01:43:59.000Z',
  base: base === null ? null : { trend: base, avg7: null, avg30: null },
  reverseHolo: reverseHolo === null ? null : { trend: reverseHolo, avg7: null, avg30: null },
});
const slot = (cardId: string, count: number): DeckCard => ({ region: 'intl', cardId, count });
const owned = (slots: Record<string, number>): DeckOwned => ({
  slots: new Map(
    Object.entries(slots).map(([key, missing]): [string, SlotOwned] => [
      key,
      { owned: 0, fromOther: 0, missing },
    ])
  ),
  considering: new Map(),
  missing: Object.values(slots).reduce((sum, missing) => sum + missing, 0),
  unknown: 0,
});

describe('slotPrice', () => {
  it('is the base finish’s price, else the reverse holo’s', () => {
    expect(slotPrice(prices(1.5, 3))).toBe(1.5);
    expect(slotPrice(prices(null, 3))).toBe(3);
    expect(slotPrice({ ...prices(null), base: { trend: null, avg7: 1, avg30: 2 } })).toBe(2);
    expect(slotPrice(prices(null))).toBeNull();
    expect(slotPrice(undefined)).toBeNull();
  });
});

describe('deckCost', () => {
  const PRICES = new Map([
    ['intl:a', prices(0.1)],
    ['intl:b', prices(2.5)],
  ]);

  it('totals every copy in the deck, counting those without a price', () => {
    const cost = deckCost([slot('a', 3), slot('b', 2), slot('c', 4)], PRICES, undefined);

    expect(cost).toEqual({ deck: { euros: 5.3, unpriced: 4 }, toComplete: null });
  });

  it('totals the copies still needed once the collection’s been compared', () => {
    const cost = deckCost(
      [slot('a', 3), slot('b', 2), slot('c', 4)],
      PRICES,
      owned({ 'intl:a': 1, 'intl:b': 2, 'intl:c': 1 })
    );

    expect(cost.toComplete).toEqual({ euros: 5.1, unpriced: 1, copies: 4 });
  });

  it('needs nothing when the collection covers the deck', () => {
    expect(deckCost([slot('a', 3)], PRICES, owned({ 'intl:a': 0 })).toComplete).toEqual({
      euros: 0,
      unpriced: 0,
      copies: 0,
    });
  });
});
