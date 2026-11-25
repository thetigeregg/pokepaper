import { stampedVariant, type CatalogCard } from '@pokepaper/shared';
import {
  assetPath,
  mergeCard,
  mergeSet,
  parseCard,
  parseSeriesList,
  parseSetDetail,
  parseSetList,
  parseStamped,
  parseTcgplayerFinishes,
  trustedLanguages,
  type RawCard,
} from './normalize.js';

const raw = (overrides: Partial<RawCard> = {}): RawCard => ({
  ...(parseCard({
    id: 'sv01-001',
    localId: '001',
    name: 'Pineco',
    category: 'Pokemon',
  }) as RawCard),
  ...overrides,
});

describe('assetPath', () => {
  it.each([
    ['https://assets.tcgdex.net/fr/sv/sv01/001', 'fr/sv/sv01/001'],
    ['https://assets.tcgdex.net/univ/sv/sv03.5/symbol', 'univ/sv/sv03.5/symbol'],
    ['https://assets.tcgdex.net/zh-tw/SV/SV2a/001', 'zh-tw/SV/SV2a/001'],
  ])('keeps the path of %s', (url, path) => {
    expect(assetPath(url)).toBe(path);
  });

  it.each([
    'https://example.com/fr/sv/sv01/001',
    'https://assets.tcgdex.net/fr/../../etc/passwd',
    'https://assets.tcgdex.net/single',
    'https://assets.tcgdex.net/fr/sv/sv01/a b',
    'https://assets.tcgdex.net/fr//sv01',
    42,
    undefined,
  ])('rejects %s', (value) => {
    expect(assetPath(value)).toBeNull();
  });
});

describe('parsers', () => {
  it('parse listings, dropping invalid entries', () => {
    expect(parseSeriesList([{ id: 'sv', name: 'S&V' }, { id: 'x' }, 'junk'])).toEqual([
      { id: 'sv', name: 'S&V', logo: null },
    ]);
    expect(parseSetList([{ id: 'sv01' }, {}, null])).toEqual([{ id: 'sv01' }]);
    expect(parseSeriesList({})).toBeNull();
    expect(parseSetList('nope')).toBeNull();
  });

  it('parse a set detail, deduplicating cards and validating the date', () => {
    expect(
      parseSetDetail({
        id: 'sv01',
        name: 'S&V',
        serie: { id: 'sv' },
        releaseDate: 'soon',
        cardCount: { total: 'many' },
        cards: [
          { id: 'sv01-001', localId: '001' },
          { id: 'sv01-001', localId: '001' },
          { id: 'sv01-002' },
        ],
      })
    ).toMatchObject({
      releaseDate: null,
      cardCount: { total: 1, official: 0 },
      abbreviation: null,
      cards: [{ id: 'sv01-001', localId: '001' }],
    });
    expect(parseSetDetail({ id: 'sv01', name: 'S&V', cards: [] })).toBeNull();
  });

  it('parse a card, bounding text and normalizing numbers', () => {
    const card = parseCard({
      id: 'sv01-001',
      localId: '001',
      name: '  Pineco  ',
      category: 'Pokemon',
      hp: '60',
      retreat: -1,
      dexId: [204, 'x', 1.5],
      description: 'x'.repeat(10_000),
      attacks: [
        { name: 'Guard Press', cost: ['Colorless', 3], damage: 10 },
        { name: 'Double', damage: '30×' },
        { effect: 'nameless' },
      ],
      abilities: [{ name: 'Sturdy' }],
    });

    expect(card).toMatchObject({
      name: 'Pineco',
      hp: 60,
      retreat: null,
      dexIds: [204],
      attacks: [
        { name: 'Guard Press', cost: ['Colorless'], damage: '10', effect: null },
        { name: 'Double', cost: [], damage: '30×' },
      ],
      abilities: [{ type: 'Ability', name: 'Sturdy', effect: null }],
    });
    expect(card?.description).toHaveLength(4000);
    expect(parseCard({ id: 'x', localId: '1', name: 'No category' })).toBeNull();
    expect(parseCard([])).toBeNull();
  });
});

describe('parseTcgplayerFinishes', () => {
  const finishes = (tcgplayer: unknown) => parseTcgplayerFinishes({ pricing: { tcgplayer } });
  /** A TCGplayer entry with a price. */
  const priced = { productId: 85495, lowPrice: 11.33, marketPrice: null };

  it('reads the finishes TCGplayer prices the card in', () => {
    // BREAKthrough Typhlosion: a holo rare TCGdex lists as normal only.
    expect(
      finishes({ unit: 'USD', holofoil: { marketPrice: 6.49 }, 'reverse-holofoil': priced })
    ).toEqual({ normal: false, holo: true, reverse: true, firstEdition: false });
    expect(finishes({ normal: priced, 'reverse-holofoil': priced })).toMatchObject({
      normal: true,
      holo: false,
      reverse: true,
    });
  });

  it('reads WotC-era editions as their finishes', () => {
    expect(finishes({ '1st-edition': priced, unlimited: priced })).toEqual({
      normal: true,
      holo: false,
      reverse: false,
      firstEdition: true,
    });
    expect(finishes({ '1st-edition-holofoil': priced, 'unlimited-holofoil': priced })).toEqual({
      normal: false,
      holo: true,
      reverse: false,
      firstEdition: true,
    });
  });

  it('counts only entries with a price', () => {
    expect(
      finishes({
        normal: priced,
        'reverse-holofoil': { productId: 85495, lowPrice: null, midPrice: 0, marketPrice: 'n/a' },
      })
    ).toMatchObject({ normal: true, reverse: false });
    expect(finishes({ holofoil: {} })).toBeNull();
  });

  it('is null without any finish it knows', () => {
    expect(finishes({ unit: 'USD', updated: '2026-11-23', 'staff-foil': priced })).toBeNull();
    expect(finishes({ holofoil: null })).toBeNull();
    expect(finishes(null)).toBeNull();
    expect(parseTcgplayerFinishes({ pricing: null })).toBeNull();
    expect(parseTcgplayerFinishes({})).toBeNull();
  });

  it('is part of a parsed card', () => {
    const card = parseCard({
      id: 'xy8-20',
      localId: '20',
      name: 'Typhlosion',
      category: 'Pokemon',
      pricing: { tcgplayer: { holofoil: { marketPrice: 6.49 } } },
    });
    expect(card?.tcgplayerFinishes).toMatchObject({ holo: true, reverse: false });
    expect(raw().tcgplayerFinishes).toBeNull();
  });
});

describe('parseStamped', () => {
  const stamped = (variants_detailed: unknown) => parseStamped({ variants_detailed });
  /** A card's unstamped holo and reverse holo entries. */
  const plain = [
    { type: 'holo', size: 'standard', variantId: 'jr7oetx1mqug9' },
    { type: 'reverse', variantId: 'cm4kqul3x1bwlz1f' },
  ];

  it('reads the stamped versions, keyed by variantId', () => {
    // Team Rocket Dark Gyarados: the plain holo and 1st edition are plain variants.
    expect(
      stamped([
        { type: 'holo', size: 'standard', variantId: 'jr7oetx1mqug9' },
        {
          type: 'holo',
          size: 'standard',
          stamp: ['1st-edition'],
          thirdParty: { cardmarket: 274061 },
          variantId: '3a83wf50ts0izj268xwv3crwi',
        },
        {
          type: 'holo',
          size: 'standard',
          stamp: ['pre-release'],
          thirdParty: { cardmarket: 275574 },
          variantId: '3a83wf50typ2p5qsrlm6y3f8o',
        },
      ])
    ).toEqual([
      {
        key: stampedVariant('3a83wf50typ2p5qsrlm6y3f8o'),
        type: 'holo',
        stamps: ['pre-release'],
        idProduct: 275574,
      },
    ]);
  });

  it('keeps every stamp, with the subtype and foil, and no product when TCGdex has none', () => {
    expect(
      stamped([
        ...plain,
        {
          type: 'reverse',
          subtype: 'unlimited',
          foil: 'pokeball',
          stamp: ['1st-edition', 'staff'],
          variantId: 'abc123',
        },
      ])
    ).toEqual([
      {
        key: 'vabc123',
        type: 'reverse',
        stamps: ['1st-edition', 'staff'],
        subtype: 'unlimited',
        foil: 'pokeball',
      },
    ]);
  });

  it('skips a stamped entry that is the card’s only one of its finish', () => {
    // Team Rocket Returns Uncommon: every reverse holo has the set logo.
    expect(
      stamped([
        { type: 'normal', variantId: 'endfynwn4n10gzq' },
        { type: 'reverse', stamp: ['set-logo'], variantId: '3a83wf50tyyzu7r7ryiw8tit7' },
      ])
    ).toEqual([]);
    // Only a jumbo or 1st edition W promo without a stamp: still a plain holo.
    expect(
      stamped([
        { type: 'holo', size: 'jumbo', variantId: 'j1' },
        { type: 'holo', stamp: ['staff'], variantId: 'a1' },
      ])
    ).toEqual([]);
    expect(
      stamped([
        { type: 'holo', stamp: ['1st-edition', 'w-Promo'], variantId: 'w1' },
        { type: 'holo', stamp: ['staff'], variantId: 'a1' },
      ])
    ).toEqual([{ key: 'va1', type: 'holo', stamps: ['staff'] }]);
  });

  it('skips a set logo stamp without its own product on a card listing no reverse holo', () => {
    // Holon Phantoms Raichu δ: TCGdex's "holo with the set logo" is its reverse holo.
    const raichu = [
      { type: 'holo', thirdParty: { cardmarket: 276985 }, variantId: 'jr7oetx1mqug9' },
      { type: 'holo', stamp: ['set-logo'], variantId: '555jb0efopmyclvkikic41' },
    ];
    expect(stamped(raichu)).toEqual([]);
    expect(stamped([raichu[0], { ...raichu[1], thirdParty: { cardmarket: 276985 } }])).toEqual([]);
    // With its own product (Prismatic Evolutions' stamped promos), or beside a
    // reverse holo, or with another stamp, it's a version of its own.
    const own = { ...raichu[1], thirdParty: { cardmarket: 812345 } };
    expect(stamped([raichu[0], own])).toEqual([
      {
        key: stampedVariant('555jb0efopmyclvkikic41'),
        type: 'holo',
        stamps: ['set-logo'],
        idProduct: 812345,
      },
    ]);
    expect(stamped([...raichu, { type: 'reverse', variantId: 'r1' }])).toHaveLength(1);
    expect(stamped([raichu[0], { ...raichu[1], stamp: ['set-logo', 'staff'] }])).toHaveLength(1);
  });

  it.each([
    [
      'with only plain stamps',
      { type: 'holo', stamp: ['1st-edition', 'w-promo'], variantId: 'a1' },
    ],
    ['in jumbo size', { type: 'holo', size: 'jumbo', stamp: ['staff'], variantId: 'a1' }],
    ['of another finish', { type: 'metal', stamp: ['staff'], variantId: 'a1' }],
    ['in another language', { type: 'Holo', stamp: ['Vorveröffentlichung'], variantId: 'a1' }],
    [
      'with a stamp name that is not a slug',
      { type: 'holo', stamp: ['Pré-release'], variantId: 'a1' },
    ],
    ['generated from the flags', { type: 'holo', stamp: ['staff'], variantId: 'generated' }],
    ['without a variantId', { type: 'holo', stamp: ['staff'] }],
    ['that is not an object', 'staff'],
  ])('skips an entry %s', (_label, entry) => {
    expect(stamped([...plain, entry])).toEqual([]);
  });

  it('skips a second entry with the same key, and an invalid product', () => {
    const entry = {
      type: 'holo',
      stamp: ['staff'],
      variantId: 'a1',
      thirdParty: { cardmarket: -4 },
    };
    expect(stamped([...plain, entry, { ...entry, stamp: ['pre-release'] }])).toEqual([
      { key: 'va1', type: 'holo', stamps: ['staff'] },
    ]);
  });

  it('reads every detailed variant, keeping up to 30 versions', () => {
    // A World Championship card: its plain holo listed after 40 stamped ones.
    const decks = Array.from({ length: 40 }, (_, index) => ({
      type: 'holo',
      stamp: [`player-${String(index)}`],
      variantId: `p${String(index)}`,
    }));
    const versions = stamped([...decks, { type: 'holo', variantId: 'jr7oetx1mqug9' }]);
    expect(versions).toHaveLength(30);
    expect(versions?.[0]).toEqual({ key: 'vp0', type: 'holo', stamps: ['player-0'] });
  });

  it('reads names in any case, and skips a subtype or foil that is not a slug', () => {
    expect(stamped([...plain, { type: 'holo', stamp: ['Pre-Release'], variantId: 'a1' }])).toEqual([
      { key: 'va1', type: 'holo', stamps: ['pre-release'] },
    ]);
    expect(
      stamped([
        ...plain,
        { type: 'holo', stamp: ['staff'], subtype: 'Sans ombre', variantId: 'a1' },
        { type: 'holo', stamp: ['staff'], foil: 'Lumière', variantId: 'a2' },
        { type: 'holo', stamp: ['staff'], subtype: 'Shadowless', variantId: 'a3' },
      ])
    ).toEqual([{ key: 'va3', type: 'holo', stamps: ['staff'], subtype: 'shadowless' }]);
  });

  it('is null without detailed variants, and part of a parsed card', () => {
    expect(stamped(undefined)).toBeNull();
    expect(stamped([])).toEqual([]);
    expect(raw().stamped).toBeNull();
    const card = parseCard({
      id: 'sm3-94',
      localId: '94',
      name: 'Diancie',
      category: 'Pokemon',
      variants_detailed: [...plain, { type: 'holo', stamp: ['poke-ball-league'], variantId: 'b2' }],
    });
    expect(card?.stamped).toEqual([{ key: 'vb2', type: 'holo', stamps: ['poke-ball-league'] }]);
  });
});

describe('trustedLanguages', () => {
  it('leaves out a set’s misattributed languages', () => {
    expect(trustedLanguages('asia', 'SV-P', ['ja', 'zh-tw'])).toEqual(['ja']);
  });

  it('keeps a card only the misattributed language has', () => {
    expect(trustedLanguages('asia', 'SV-P', ['zh-tw'])).toEqual(['zh-tw']);
  });

  it.each([
    ['another set', 'asia', 'SV2a'],
    ['the same set ID in another region', 'intl', 'SV-P'],
    ['a set ID named like an object property', 'asia', 'constructor'],
  ] as const)('keeps every language of %s', (_label, region, setId) => {
    expect(trustedLanguages(region, setId, ['ja', 'zh-tw'])).toEqual(['ja', 'zh-tw']);
  });
});

describe('mergeCard', () => {
  const base = {
    region: 'intl' as const,
    setId: 'sv01',
    localId: '001',
    sortIndex: 0,
    vocabularies: new Map(),
  };

  it('keeps stored neutral fields and text when the preferred language was not refetched', () => {
    const existing = mergeCard({
      ...base,
      languages: ['en', 'fr'],
      fetched: new Map([
        ['en', raw({ rarity: 'Common' })],
        ['fr', raw({ name: 'Pomdepik', rarity: 'Commune' })],
      ]),
      existing: undefined,
    }) as CatalogCard;

    const merged = mergeCard({
      ...base,
      languages: ['en', 'fr', 'de'],
      fetched: new Map([['de', raw({ name: 'Tannza', rarity: 'Häufig' })]]),
      existing,
    });

    expect(merged?.rarity).toBe('Common');
    expect(Object.keys(merged?.text ?? {})).toEqual(['en', 'fr', 'de']);
    expect(merged?.text.de?.name).toBe('Tannza');
  });

  it('drops languages the card no longer exists in', () => {
    const existing = mergeCard({
      ...base,
      languages: ['en', 'fr'],
      fetched: new Map([
        ['en', raw()],
        ['fr', raw({ name: 'Pomdepik' })],
      ]),
      existing: undefined,
    }) as CatalogCard;

    const merged = mergeCard({ ...base, languages: ['en'], fetched: new Map(), existing });

    expect(Object.keys(merged?.text ?? {})).toEqual(['en']);
  });

  it('carries TCGplayer’s finishes when it lists any, and keeps stored ones', () => {
    const finishes = { normal: false, holo: true, reverse: true, firstEdition: false };
    const fresh = mergeCard({
      ...base,
      languages: ['en', 'fr'],
      fetched: new Map([['en', raw({ tcgplayerFinishes: finishes })]]),
      existing: undefined,
    }) as CatalogCard;
    expect(fresh.tcgplayerFinishes).toEqual(finishes);

    const kept = mergeCard({
      ...base,
      languages: ['en', 'fr'],
      fetched: new Map([['fr', raw({ name: 'Pomdepik' })]]),
      existing: fresh,
    });
    expect(kept?.tcgplayerFinishes).toEqual(finishes);

    const without = mergeCard({
      ...base,
      languages: ['en'],
      fetched: new Map([['en', raw()]]),
      existing: undefined,
    });
    expect(without).not.toHaveProperty('tcgplayerFinishes');
  });

  it('keeps a finish once TCGplayer has listed it', () => {
    const stored = mergeCard({
      ...base,
      languages: ['en'],
      fetched: new Map([
        [
          'en',
          raw({
            tcgplayerFinishes: { normal: false, holo: true, reverse: true, firstEdition: false },
          }),
        ],
      ]),
      existing: undefined,
    }) as CatalogCard;

    // The reverse holo's entry dropped out (no recent sales); a normal one appeared.
    const refetched = mergeCard({
      ...base,
      languages: ['en'],
      fetched: new Map([
        [
          'en',
          raw({
            tcgplayerFinishes: { normal: true, holo: true, reverse: false, firstEdition: false },
          }),
        ],
      ]),
      existing: stored,
    });
    expect(refetched?.tcgplayerFinishes).toEqual({
      normal: true,
      holo: true,
      reverse: true,
      firstEdition: false,
    });

    // None listed now: the stored ones stay.
    const listedNone = mergeCard({
      ...base,
      languages: ['en'],
      fetched: new Map([['en', raw()]]),
      existing: stored,
    });
    expect(listedNone?.tcgplayerFinishes).toEqual(stored.tcgplayerFinishes);
  });

  it('reads stamped versions from the preferred language only, keeping stored ones', () => {
    const stamp = { key: 'vb2', type: 'holo' as const, stamps: ['poke-ball-league'] };
    const fresh = mergeCard({
      ...base,
      languages: ['en', 'fr'],
      fetched: new Map([
        ['en', raw({ stamped: [stamp] })],
        ['fr', raw({ name: 'Pomdepik', stamped: [{ ...stamp, stamps: ['ligue-poke-ball'] }] })],
      ]),
      existing: undefined,
    }) as CatalogCard;
    expect(fresh.stamped).toEqual([stamp]);

    const kept = mergeCard({
      ...base,
      languages: ['en', 'fr'],
      fetched: new Map([['fr', raw({ name: 'Pomdepik', stamped: [] })]]),
      existing: fresh,
    });
    expect(kept?.stamped).toEqual([stamp]);

    // No detailed variants in the response: a gap, not a removal.
    const gap = mergeCard({
      ...base,
      languages: ['en', 'fr'],
      fetched: new Map([['en', raw()]]),
      existing: fresh,
    });
    expect(gap?.stamped).toEqual([stamp]);

    const dropped = mergeCard({
      ...base,
      languages: ['en', 'fr'],
      fetched: new Map([['en', raw({ stamped: [] })]]),
      existing: fresh,
    });
    expect(dropped).not.toHaveProperty('stamped');

    const onlyFrench = mergeCard({
      ...base,
      languages: ['fr'],
      fetched: new Map([['fr', raw({ name: 'Pomdepik', stamped: [stamp] })]]),
      existing: undefined,
    });
    expect(onlyFrench).not.toHaveProperty('stamped');
  });

  it('returns null when no language has data', () => {
    expect(
      mergeCard({ ...base, languages: ['en'], fetched: new Map(), existing: undefined })
    ).toBeNull();
  });
});

describe('mergeSet', () => {
  it('lists only languages with cards, and fills gaps from other languages', () => {
    const detail = (name: string, cards: number, releaseDate: string | null) => ({
      ...(parseSetDetail({ id: 'SV2a', name, serie: { id: 'SV' }, cards: [] }) as NonNullable<
        ReturnType<typeof parseSetDetail>
      >),
      releaseDate,
      cards: Array.from({ length: cards }, (_, index) => ({
        id: `SV2a-${String(index)}`,
        localId: String(index),
      })),
    });

    const set = mergeSet(
      'asia',
      new Map([
        ['zh-tw', detail('寶可夢卡牌151', 0, '2023-06-16')],
        ['ja', detail('ポケモンカード151', 2, null)],
      ])
    );

    expect(set).toMatchObject({
      names: { ja: 'ポケモンカード151', 'zh-tw': '寶可夢卡牌151' },
      releaseDate: '2023-06-16',
      languages: ['ja'],
    });
    expect(mergeSet('asia', new Map())).toBeNull();
  });
});
