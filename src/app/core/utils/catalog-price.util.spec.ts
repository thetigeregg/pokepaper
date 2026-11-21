import type { CatalogCardPrices, CatalogRegion, CollectionEntry } from '@pokepaper/shared';
import { collectionValue, headlinePrice, variantFigures } from './catalog-price.util';

const prices = (
  base: number | null,
  reverseHolo: number | null = null,
  updated = '2026-11-21T05:47:42.306Z'
): CatalogCardPrices => ({
  updated,
  base: base === null ? null : { trend: base, avg7: null, avg30: null },
  reverseHolo: reverseHolo === null ? null : { trend: reverseHolo, avg7: null, avg30: null },
});

const entry = (
  overrides: Partial<CollectionEntry> & { region?: CatalogRegion }
): CollectionEntry & { region: CatalogRegion } => ({
  region: 'intl',
  cardId: 'sv01-001',
  setId: 'sv01',
  variant: 'normal',
  language: 'en',
  quantity: 1,
  ...overrides,
});

describe('headlinePrice', () => {
  it('is the trend, else the 30-day average', () => {
    expect(headlinePrice({ trend: 0.14, avg7: 0.1, avg30: 0.08 })).toBe(0.14);
    expect(headlinePrice({ trend: null, avg7: 0.1, avg30: 0.08 })).toBe(0.08);
    expect(headlinePrice({ trend: null, avg7: 0.1, avg30: null })).toBeNull();
  });
});

describe('variantFigures', () => {
  it('values normal and holo copies by the base finish, reverse holos by the reverse', () => {
    const card = prices(1, 2);

    expect(variantFigures(card, 'normal')?.trend).toBe(1);
    expect(variantFigures(card, 'holo')?.trend).toBe(1);
    expect(variantFigures(card, 'reverse')?.trend).toBe(2);
    expect(variantFigures(card, 'firstEdition')).toBeNull();
    expect(variantFigures(card, 'wPromo')).toBeNull();
    expect(variantFigures(card, 'staff-stamp')).toBeNull(); // a variant from a newer build
  });
});

describe('collectionValue', () => {
  it('sums every language’s copies per catalog, in cents', () => {
    const value = collectionValue(
      [
        entry({ quantity: 3 }),
        entry({ language: 'de', quantity: 2 }),
        entry({ variant: 'reverse', quantity: 1 }),
        entry({ cardId: 'sv01-002', quantity: 1 }),
        entry({ region: 'asia', cardId: 'SV2a-001', language: 'ja', quantity: 2 }),
      ],
      new Map([
        ['intl:sv01-001', prices(0.1, 0.2)],
        ['intl:sv01-002', prices(0.1, null, '2026-11-22T00:00:00.000Z')],
        ['asia:SV2a-001', prices(8.33)],
      ])
    );

    expect(value).toEqual([
      {
        region: 'intl',
        copies: 7,
        unpriced: 0,
        value: 0.8,
        updated: '2026-11-22T00:00:00.000Z',
      },
      { region: 'asia', copies: 2, unpriced: 0, value: 16.66, updated: '2026-11-21T05:47:42.306Z' },
    ]);
  });

  it('counts copies without a price instead of valuing them', () => {
    const value = collectionValue(
      [
        entry({ quantity: 2 }),
        entry({ variant: 'firstEdition', quantity: 1 }),
        entry({ variant: 'reverse', quantity: 1 }),
        entry({ cardId: 'unpriced', quantity: 4 }),
      ],
      new Map([['intl:sv01-001', prices(1.5)]])
    );

    expect(value).toEqual([
      { region: 'intl', copies: 8, unpriced: 6, value: 3, updated: '2026-11-21T05:47:42.306Z' },
    ]);
  });

  it('has no price date when nothing is priced, and no catalogs without copies', () => {
    expect(collectionValue([entry({ cardId: 'unpriced' })], new Map())).toEqual([
      { region: 'intl', copies: 1, unpriced: 1, value: 0, updated: null },
    ]);
    expect(collectionValue([], new Map())).toEqual([]);
  });
});
