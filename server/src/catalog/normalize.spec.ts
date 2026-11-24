import type { CatalogCard } from '@pokepaper/shared';
import {
  assetPath,
  mergeCard,
  mergeSet,
  parseCard,
  parseSeriesList,
  parseSetDetail,
  parseSetList,
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

  it('reads the finishes TCGplayer prices the card in', () => {
    // BREAKthrough Typhlosion: a holo rare TCGdex lists as normal only.
    expect(
      finishes({ unit: 'USD', holofoil: { marketPrice: 6.49 }, 'reverse-holofoil': {} })
    ).toEqual({ normal: false, holo: true, reverse: true, firstEdition: false });
    expect(finishes({ normal: {}, 'reverse-holofoil': {} })).toMatchObject({
      normal: true,
      holo: false,
      reverse: true,
    });
  });

  it('reads WotC-era editions as their finishes', () => {
    expect(finishes({ '1st-edition': {}, unlimited: {} })).toEqual({
      normal: true,
      holo: false,
      reverse: false,
      firstEdition: true,
    });
    expect(finishes({ '1st-edition-holofoil': {}, 'unlimited-holofoil': {} })).toEqual({
      normal: false,
      holo: true,
      reverse: false,
      firstEdition: true,
    });
  });

  it('is null without any finish it knows', () => {
    expect(finishes({ unit: 'USD', updated: '2026-11-23', 'staff-foil': {} })).toBeNull();
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
      pricing: { tcgplayer: { holofoil: {} } },
    });
    expect(card?.tcgplayerFinishes).toMatchObject({ holo: true, reverse: false });
    expect(raw().tcgplayerFinishes).toBeNull();
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
