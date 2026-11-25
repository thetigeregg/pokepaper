import type {
  CatalogCardPrices,
  CatalogFinishes,
  CatalogRegion,
  CollectionEntry,
} from '@pokepaper/shared';
import {
  beforeReverseHolos,
  collectionValue,
  flagsReverseHolos,
  headlinePrice,
  reverseHoloPossible,
  variantFigures,
  setReverseHolos,
  type ReverseHoloCard,
  type ReverseHoloSet,
  type SetReverseHolos,
} from './catalog-price.util';

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

  it('takes the 30-day average for a trend more than ten times off it', () => {
    // Team Rocket's Dark Gyarados and Delta Reign's Mega Golisopod ex in a November 2026 guide.
    expect(headlinePrice({ trend: 0.02, avg7: 88.72, avg30: 162.97 })).toBe(162.97);
    expect(headlinePrice({ trend: 0.02, avg7: 0.43, avg30: 0.54 })).toBe(0.54);
    // A trend far above anything sold.
    expect(headlinePrice({ trend: 6131.07, avg7: null, avg30: 500 })).toBe(500);
    expect(headlinePrice({ trend: 3.24, avg7: 0.33, avg30: 0.24 })).toBe(0.24);
  });

  it('keeps the trend when the 7-day average is closer to it than the 30-day one', () => {
    // One inflated sale in the 30-day average.
    expect(headlinePrice({ trend: 7.69, avg7: 14.46, avg30: 79.68 })).toBe(7.69);
    // Bulk commons: €0.02, padded to €0.45 over 30 days.
    expect(headlinePrice({ trend: 0.02, avg7: 0.08, avg30: 0.45 })).toBe(0.02);
    expect(headlinePrice({ trend: 104.14, avg7: 118.86, avg30: 7.06 })).toBe(104.14);
  });

  it('checks against the 7-day average when there’s no 30-day one', () => {
    expect(headlinePrice({ trend: 0.02, avg7: 120, avg30: null })).toBe(120);
    expect(headlinePrice({ trend: 0.02, avg7: 120, avg30: 0 })).toBe(120);
    expect(headlinePrice({ trend: 15, avg7: 120, avg30: null })).toBe(15);
  });

  it('keeps a trend within ten times the averages, or without any', () => {
    expect(headlinePrice({ trend: 4.61, avg7: 5.15, avg30: 5.75 })).toBe(4.61);
    expect(headlinePrice({ trend: 1, avg7: null, avg30: 10 })).toBe(1);
    expect(headlinePrice({ trend: 100, avg7: null, avg30: 10 })).toBe(100);
    expect(headlinePrice({ trend: 0.02, avg7: null, avg30: null })).toBe(0.02);
    expect(headlinePrice({ trend: 0, avg7: 0, avg30: 0 })).toBe(0);
  });

  it('takes the average for a zero trend', () => {
    expect(headlinePrice({ trend: 0, avg7: 2, avg30: 3 })).toBe(3);
  });
});

/** A card's reverse holo fields: plain, normal only, unless `overrides` say otherwise. */
const printing = (
  overrides: {
    region?: CatalogRegion;
    rarity?: string | null;
    suffix?: string | null;
    reverse?: boolean;
    localId?: string;
    name?: string;
    tcgplayerFinishes?: CatalogFinishes;
  } = {}
): ReverseHoloCard => ({
  region: overrides.region ?? 'intl',
  localId: overrides.localId ?? '001',
  rarity: overrides.rarity === undefined ? 'Common' : overrides.rarity,
  suffix: overrides.suffix ?? null,
  variants: {
    normal: true,
    reverse: overrides.reverse ?? false,
    holo: false,
    firstEdition: false,
    wPromo: false,
  },
  ...(overrides.tcgplayerFinishes && { tcgplayerFinishes: overrides.tcgplayerFinishes }),
  text: {
    en: {
      name: overrides.name ?? 'Pineco',
      description: null,
      effect: null,
      evolveFrom: null,
      attacks: [],
      abilities: [],
      image: null,
    },
  },
});
/** A set released on `releaseDate`, named `name`. */
const released = (releaseDate: string | null, name = 'Fates Collide'): ReverseHoloSet => ({
  releaseDate,
  names: { en: name },
});
const finishes = (overrides: Partial<CatalogFinishes>): CatalogFinishes => ({
  normal: false,
  holo: false,
  reverse: false,
  firstEdition: false,
  ...overrides,
});

describe('flagsReverseHolos', () => {
  it('holds when most of a set’s plain commons and uncommons are flagged', () => {
    const flagged = printing({ reverse: true });
    const unflagged = printing();

    expect(flagsReverseHolos([flagged, flagged, printing({ rarity: 'Uncommon' })])).toBe(true);
    // Forbidden Light: one flagged common in a set of unflagged ones.
    expect(flagsReverseHolos([flagged, unflagged, unflagged])).toBe(false);
    expect(flagsReverseHolos([flagged, unflagged])).toBe(false);
    expect(flagsReverseHolos([])).toBe(false);
  });

  it('counts only plain commons and uncommons', () => {
    const others = [
      printing({ rarity: 'Rare' }),
      printing({ rarity: 'Ultra Rare', suffix: 'EX' }),
      printing({ suffix: 'EX' }), // a promo Tornadus-EX listed as Common
      printing({ rarity: null }),
    ];

    expect(flagsReverseHolos([printing({ reverse: true }), ...others])).toBe(true);
    expect(
      flagsReverseHolos([
        printing(),
        ...others.map((card) => ({ ...card, variants: { ...card.variants, reverse: true } })),
      ])
    ).toBe(false);
  });
});

describe('setReverseHolos', () => {
  it('tells whether TCGdex keeps the flags and whether TCGplayer sells any reverse holo', () => {
    const plain = printing();
    const sold = printing({ tcgplayerFinishes: finishes({ normal: true, reverse: true }) });
    expect(setReverseHolos([printing({ reverse: true }), plain, plain])).toEqual({
      tcgdexFlags: false,
      tcgplayerSells: false,
    });
    expect(
      setReverseHolos([printing({ reverse: true }), printing({ reverse: true }), sold])
    ).toEqual({ tcgdexFlags: true, tcgplayerSells: true });
  });
});

describe('reverseHoloPossible', () => {
  const modern = released('2016-05-02');
  /** A set whose reverse holo flags TCGdex keeps. */
  const keeps: SetReverseHolos = { tcgdexFlags: true, tcgplayerSells: false };
  /** A set without flags where TCGplayer sells reverse holos (BREAKthrough). */
  const flagless: SetReverseHolos = { tcgdexFlags: false, tcgplayerSells: true };
  /** A set without flags where TCGplayer sells no reverse holo (POP Series 3). */
  const noneSold: SetReverseHolos = { tcgdexFlags: false, tcgplayerSells: false };

  it('holds whenever TCGdex flags the card, from reverse holos on', () => {
    expect(reverseHoloPossible(printing({ reverse: true }), modern, keeps)).toBe(true);
    expect(reverseHoloPossible(printing({ reverse: true }), released('2002-05-24'), keeps)).toBe(
      true
    );
  });

  it('fails for cards from before reverse holos, even flagged ones', () => {
    // Wizards promo 34 Entei: TCGdex flags it reverse holo only.
    expect(reverseHoloPossible(printing({ reverse: true }), released('1999-07-01'), flagless)).toBe(
      false
    );
    expect(reverseHoloPossible(printing(), released('1999-01-09'), flagless)).toBe(false);
    expect(reverseHoloPossible(printing(), released('2002-05-24'), flagless)).toBe(true);
    expect(reverseHoloPossible(printing(), released(null), flagless)).toBe(true);
  });

  it('fails for unflagged cards in a set whose flags TCGdex keeps', () => {
    // EX Dragon's Kingdra ex: holo only, in a set with flagged commons.
    expect(
      reverseHoloPossible(
        {
          ...printing({ rarity: 'Rare', suffix: 'ex' }),
          variants: { ...printing().variants, normal: false, holo: true },
        },
        released('2003-11-24'),
        keeps
      )
    ).toBe(false);
    expect(reverseHoloPossible(printing(), modern, keeps)).toBe(false);
  });

  it('goes by rarity and suffix in a set without flags', () => {
    for (const rarity of ['Common', 'Uncommon', 'Rare', 'Holo Rare', 'Rare Holo']) {
      expect(reverseHoloPossible(printing({ rarity }), modern, flagless)).toBe(true);
    }
    // Fates Collide's full art Kingdra-EX.
    expect(
      reverseHoloPossible(printing({ rarity: 'Ultra Rare', suffix: 'EX' }), modern, flagless)
    ).toBe(false);
    expect(reverseHoloPossible(printing({ rarity: 'Rare', suffix: 'EX' }), modern, flagless)).toBe(
      false
    );
    for (const rarity of ['Secret Rare', 'Promo', 'Shiny rare', 'None', null]) {
      expect(reverseHoloPossible(printing({ rarity }), modern, flagless)).toBe(false);
    }
  });

  it('goes by TCGplayer’s finishes in a set without flags, when it lists any', () => {
    // BREAKthrough Typhlosion: TCGdex lists it as normal only.
    expect(
      reverseHoloPossible(
        printing({ rarity: 'Rare', tcgplayerFinishes: finishes({ holo: true, reverse: true }) }),
        modern,
        flagless
      )
    ).toBe(true);
    // POP Series 3 Flareon: a plain Rare, but TCGplayer sells no card of its set in reverse holo.
    expect(
      reverseHoloPossible(
        printing({ rarity: 'Rare', tcgplayerFinishes: finishes({ normal: true, holo: true }) }),
        released('2006-04-01', 'POP Series 3'),
        noneSold
      )
    ).toBe(false);
    // Delta Reign 094: an uncommon TCGplayer lists in normal only, in a set it sells
    // reverse holos of: the missing entry is no evidence, so the rarity decides.
    expect(
      reverseHoloPossible(
        printing({ rarity: 'Uncommon', tcgplayerFinishes: finishes({ normal: true }) }),
        released('2026-11-06', 'Delta Reign'),
        flagless
      )
    ).toBe(true);
    expect(
      reverseHoloPossible(
        printing({ rarity: 'Ultra Rare', tcgplayerFinishes: finishes({ holo: true }) }),
        released('2026-11-06', 'Delta Reign'),
        flagless
      )
    ).toBe(false);
    // An ex card TCGplayer sells in reverse holo, against the suffix rule.
    expect(
      reverseHoloPossible(
        printing({ suffix: 'ex', tcgplayerFinishes: finishes({ reverse: true }) }),
        modern,
        flagless
      )
    ).toBe(true);
  });

  it('keeps TCGdex’s word over TCGplayer’s where TCGdex keeps the flags', () => {
    expect(
      reverseHoloPossible(
        printing({ tcgplayerFinishes: finishes({ reverse: true }) }),
        modern,
        keeps
      )
    ).toBe(false);
    expect(
      reverseHoloPossible(
        printing({ reverse: true, tcgplayerFinishes: finishes({ normal: true }) }),
        modern,
        flagless
      )
    ).toBe(true);
  });

  it('leaves out Prism Stars, subsets without reverse holos and promo sets without TCGplayer’s word', () => {
    // Forbidden Light's Arceus ◇: TCGdex gives Prism Stars no suffix.
    expect(
      reverseHoloPossible(printing({ rarity: 'Rare', name: 'Arceus ◇' }), modern, flagless)
    ).toBe(false);
    // Generations' Radiant Collection, the Trainer and Galarian Galleries.
    for (const localId of ['RC10', 'TG01', 'GG24']) {
      expect(reverseHoloPossible(printing({ localId }), modern, flagless)).toBe(false);
    }
    // DP Black Star Promos' Garchomp C LV.X: a Common to TCGdex.
    expect(
      reverseHoloPossible(printing(), released('2007-05-01', 'DP Black Star Promos'), flagless)
    ).toBe(false);
    // TCGplayer's word still counts there.
    expect(
      reverseHoloPossible(
        printing({ tcgplayerFinishes: finishes({ reverse: true }) }),
        released('2003-10-01', 'Nintendo Black Star Promos'),
        flagless
      )
    ).toBe(true);
  });

  it('goes only by the flags in the Japan & Asia catalog', () => {
    expect(
      reverseHoloPossible(
        printing({ region: 'asia', tcgplayerFinishes: finishes({ reverse: true }) }),
        modern,
        flagless
      )
    ).toBe(false);
    expect(reverseHoloPossible(printing({ region: 'asia' }), modern, flagless)).toBe(false);
    expect(
      reverseHoloPossible(printing({ region: 'asia', rarity: 'Holo Rare' }), modern, flagless)
    ).toBe(false);
    expect(reverseHoloPossible(printing({ region: 'asia', reverse: true }), modern, flagless)).toBe(
      true
    );
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
    expect(variantFigures(card, 'vp2p5qsrlm6y3f8o')).toBeNull(); // a stamped version
    expect(variantFigures(card, 'staff-stamp')).toBeNull(); // a variant from a newer build
  });

  it('values reverse holos by the base finish in a set from before reverse holos', () => {
    const card = prices(1, 2);

    expect(variantFigures(card, 'reverse', true)?.trend).toBe(1);
    expect(variantFigures(card, 'normal', true)?.trend).toBe(1);
  });
});

describe('beforeReverseHolos', () => {
  it('holds for sets released before May 24, 2002', () => {
    expect(beforeReverseHolos({ releaseDate: '2002-05-23' })).toBe(true);
    expect(beforeReverseHolos({ releaseDate: '2002-05-24' })).toBe(false);
    expect(beforeReverseHolos({ releaseDate: null })).toBe(false);
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
        entry({ variant: 'vp2p5qsrlm6y3f8o', quantity: 2 }),
        entry({ cardId: 'unpriced', quantity: 4 }),
      ],
      new Map([['intl:sv01-001', prices(1.5)]])
    );

    expect(value).toEqual([
      { region: 'intl', copies: 10, unpriced: 8, value: 3, updated: '2026-11-21T05:47:42.306Z' },
    ]);
  });

  it('values reverse holo copies in sets from before reverse holos by the base finish', () => {
    const value = collectionValue(
      [
        entry({ cardId: 'basep-34', setId: 'basep', variant: 'reverse', quantity: 1 }),
        entry({ variant: 'reverse', quantity: 1 }),
      ],
      new Map([
        ['intl:basep-34', prices(55.87, 12.61)],
        ['intl:sv01-001', prices(0.1, 0.2)],
      ]),
      new Set(['intl:basep'])
    );

    expect(value).toEqual([
      { region: 'intl', copies: 2, unpriced: 0, value: 56.07, updated: '2026-11-21T05:47:42.306Z' },
    ]);
  });

  it('has no price date when nothing is priced, and no catalogs without copies', () => {
    expect(collectionValue([entry({ cardId: 'unpriced' })], new Map())).toEqual([
      { region: 'intl', copies: 1, unpriced: 1, value: 0, updated: null },
    ]);
    expect(collectionValue([], new Map())).toEqual([]);
  });
});
