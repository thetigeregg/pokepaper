import { parseGuideEntry, parseProductId, toWirePrices } from './price-data.js';
import { guideFigures, tcgdexPricing } from './test-helpers.js';

const UPDATED = '2026-11-20T01:43:56.000Z';

describe('parseProductId', () => {
  it('reads Cardmarket’s product from a TCGdex card', () => {
    expect(parseProductId({ id: 'swsh3-136', pricing: tcgdexPricing(0.14, 0, 483559) })).toBe(
      483559
    );
  });

  it.each([
    ['no pricing', {}],
    ['no Cardmarket pricing', { pricing: { cardmarket: null } }],
    ['a product ID that isn’t one', { pricing: { cardmarket: { idProduct: -4 } } }],
    ['a product ID that isn’t a number', { pricing: { cardmarket: { idProduct: '483559' } } }],
  ])('is null for %s', (_label, card) => {
    expect(parseProductId(card)).toBeNull();
  });
});

describe('parseGuideEntry', () => {
  it('reads every figure for the base and reverse holo finishes', () => {
    // Furret (swsh3-136) as Cardmarket's guide had it in November 2026.
    const entry = {
      idProduct: 483559,
      idCategory: 51,
      avg: 0.08,
      low: 0.02,
      trend: 0.14,
      avg1: 0.25,
      avg7: 0.1,
      avg30: 0.08,
      'avg-holo': 0.31,
      'low-holo': 0.08,
      'trend-holo': 0.28,
      'avg1-holo': 0.2,
      'avg7-holo': 0.36,
      'avg30-holo': 0.28,
    };

    expect(parseGuideEntry(entry, UPDATED)).toEqual({
      updated: UPDATED,
      idProduct: 483559,
      base: { avg: 0.08, low: 0.02, trend: 0.14, avg1: 0.25, avg7: 0.1, avg30: 0.08 },
      reverseHolo: { avg: 0.31, low: 0.08, trend: 0.28, avg1: 0.2, avg7: 0.36, avg30: 0.28 },
    });
  });

  it('treats 0 and null as no figure, and a finish without any as absent', () => {
    // Holo-only cards: `trend-holo: 0` and nulls for the rest.
    const prices = parseGuideEntry({ idProduct: 1, ...guideFigures(313.78) }, UPDATED);

    expect(prices?.base?.trend).toBe(313.78);
    expect(prices?.reverseHolo).toBeNull();
  });

  it('keeps a finish with only some figures', () => {
    expect(parseGuideEntry({ idProduct: 1, avg30: 4.5 }, UPDATED)).toEqual({
      updated: UPDATED,
      idProduct: 1,
      base: { avg: null, low: null, trend: null, avg1: null, avg7: null, avg30: 4.5 },
      reverseHolo: null,
    });
  });

  it.each([
    ['not an object', 'n/a'],
    ['no product ID', guideFigures(1)],
    [
      'no usable figure',
      {
        idProduct: 1,
        trend: 0,
        avg: -1,
        avg7: '3',
        avg30: Number.POSITIVE_INFINITY,
        low: 1e12,
      },
    ],
  ])('returns null for %s', (_label, entry) => {
    expect(parseGuideEntry(entry, UPDATED)).toBeNull();
  });
});

describe('toWirePrices', () => {
  it('sends trend and the 7- and 30-day averages of each finish, and the product', () => {
    const stored = parseGuideEntry({ idProduct: 483559, ...guideFigures(0.14, 0.28) }, UPDATED);

    expect(stored && toWirePrices(stored)).toEqual({
      updated: UPDATED,
      idProduct: 483559,
      base: { trend: 0.14, avg7: 0.14, avg30: 0.14 },
      reverseHolo: { trend: 0.28, avg7: 0.28, avg30: 0.28 },
    });
  });

  it('never sends a product ID that isn’t one', () => {
    // Rows stored before IDs were checked can hold anything.
    expect(
      toWirePrices({
        updated: UPDATED,
        idProduct: 0,
        base: { avg: 1, low: 1, trend: 1, avg1: 1, avg7: 1, avg30: 1 },
        reverseHolo: null,
      })
    ).not.toHaveProperty('idProduct');
  });

  it('drops a finish that has none of those figures', () => {
    expect(
      toWirePrices({
        updated: UPDATED,
        idProduct: null,
        base: { avg: 1, low: 0.5, trend: null, avg1: 1, avg7: null, avg30: null },
        reverseHolo: null,
      })
    ).toEqual({ updated: UPDATED, base: null, reverseHolo: null });
  });
});
