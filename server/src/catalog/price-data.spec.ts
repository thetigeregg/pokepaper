import { parseCardmarketPrices, toWirePrices } from './price-data.js';
import { tcgdexPricing } from './test-helpers.js';

describe('parseCardmarketPrices', () => {
  it('reads every figure for the base and reverse holo finishes', () => {
    // Furret (swsh3-136) as TCGdex served it in November 2026.
    const card = {
      id: 'swsh3-136',
      pricing: {
        cardmarket: {
          updated: '2026-11-21T05:47:42.306Z',
          unit: 'EUR',
          idProduct: 483559,
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
        },
        tcgplayer: { unit: 'USD', normal: { marketPrice: 0.26 } },
      },
    };

    expect(parseCardmarketPrices(card)).toEqual({
      updated: '2026-11-21T05:47:42.306Z',
      idProduct: 483559,
      base: { avg: 0.08, low: 0.02, trend: 0.14, avg1: 0.25, avg7: 0.1, avg30: 0.08 },
      reverseHolo: { avg: 0.31, low: 0.08, trend: 0.28, avg1: 0.2, avg7: 0.36, avg30: 0.28 },
    });
  });

  it('treats 0 and null as no figure, and a finish without any as absent', () => {
    // Holo-only cards: TCGdex reports `trend-holo: 0` and nulls for the rest.
    const prices = parseCardmarketPrices({ pricing: tcgdexPricing(313.78) });

    expect(prices?.base?.trend).toBe(313.78);
    expect(prices?.reverseHolo).toBeNull();
  });

  it('keeps a finish with only some figures', () => {
    const prices = parseCardmarketPrices({
      pricing: { cardmarket: { updated: '2026-11-21T00:00:00Z', unit: 'EUR', avg30: 4.5 } },
    });

    expect(prices).toEqual({
      updated: '2026-11-21T00:00:00.000Z',
      idProduct: null,
      base: { avg: null, low: null, trend: null, avg1: null, avg7: null, avg30: 4.5 },
      reverseHolo: null,
    });
  });

  it.each([
    ['no pricing', {}],
    ['pricing that is not an object', { pricing: 'n/a' }],
    ['no Cardmarket prices', { pricing: { cardmarket: null, tcgplayer: {} } }],
    [
      'another currency',
      { pricing: { cardmarket: { ...tcgdexPricing(1).cardmarket, unit: 'USD' } } },
    ],
    [
      'no valid update time',
      { pricing: { cardmarket: { ...tcgdexPricing(1).cardmarket, updated: 'yesterday' } } },
    ],
    [
      'no usable figure',
      {
        pricing: {
          cardmarket: {
            updated: '2026-11-21T00:00:00Z',
            unit: 'EUR',
            trend: 0,
            avg: -1,
            avg7: '3',
            avg30: Number.POSITIVE_INFINITY,
            low: 1e12,
          },
        },
      },
    ],
  ])('returns null for %s', (_label, card) => {
    expect(parseCardmarketPrices(card)).toBeNull();
  });
});

describe('toWirePrices', () => {
  it('sends trend and the 7- and 30-day averages of each finish', () => {
    const stored = parseCardmarketPrices({ pricing: tcgdexPricing(0.14, 0.28) });

    expect(stored && toWirePrices(stored)).toEqual({
      updated: '2026-11-20T22:24:05.881Z',
      idProduct: 483559,
      base: { trend: 0.14, avg7: 0.14, avg30: 0.14 },
      reverseHolo: { trend: 0.28, avg7: 0.28, avg30: 0.28 },
    });
  });

  it('leaves out an unknown product ID', () => {
    expect(
      parseCardmarketPrices({
        pricing: { cardmarket: { ...tcgdexPricing(1).cardmarket, idProduct: -4 } },
      })?.idProduct
    ).toBeNull();
  });

  it('never sends a product ID that isn’t one', () => {
    // Rows stored before IDs were checked can hold anything.
    expect(
      toWirePrices({
        updated: '2026-11-21T00:00:00.000Z',
        idProduct: 0,
        base: { avg: 1, low: 1, trend: 1, avg1: 1, avg7: 1, avg30: 1 },
        reverseHolo: null,
      })
    ).not.toHaveProperty('idProduct');
  });

  it('drops a finish that has none of those figures', () => {
    expect(
      toWirePrices({
        updated: '2026-11-21T00:00:00.000Z',
        idProduct: null,
        base: { avg: 1, low: 0.5, trend: null, avg1: 1, avg7: null, avg30: null },
        reverseHolo: null,
      })
    ).toEqual({ updated: '2026-11-21T00:00:00.000Z', base: null, reverseHolo: null });
  });
});
