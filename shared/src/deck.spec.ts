import {
  deck,
  deckCardKey,
  DECK_FORMATS,
  isDeck,
  isDeckCard,
  isDeckCardCount,
  isDeckCover,
  isDeckFormat,
  isDeckId,
  isDeckName,
  MAX_DECK_CARD_COUNT,
  MAX_DECK_NAME_LENGTH,
  MAX_DECK_SLOTS,
  type Deck,
} from './index';

const valid: Deck = {
  id: '6f1c2c1e-6c1b-4a8e-9a65-0d3b8f7c2e11',
  name: 'Charizard ex',
  format: 'standard',
  cards: [
    { region: 'intl', cardId: 'sv03-125', count: 3 },
    { region: 'intl', cardId: 'sve-002', count: 9 },
  ],
  createdAt: '2026-11-19T10:00:00.000Z',
  updatedAt: '2026-11-19T10:05:00.000Z',
};

describe('isDeckFormat', () => {
  it('accepts every format', () => {
    for (const format of DECK_FORMATS) {
      expect(isDeckFormat(format)).toBe(true);
    }
  });

  it.each(['glc', '', 'Standard', null])('rejects %j', (value) => {
    expect(isDeckFormat(value)).toBe(false);
  });
});

describe('deckCardKey', () => {
  it('joins region and card ID', () => {
    expect(deckCardKey({ region: 'intl', cardId: 'sv03-125' })).toBe('intl:sv03-125');
  });
});

describe('isDeckId', () => {
  it('accepts a UUID', () => {
    expect(isDeckId(valid.id)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['too long', 'a'.repeat(65)],
    ['with a colon', 'a:b'],
    ['not a string', 1],
  ])('rejects %s', (_label, value) => {
    expect(isDeckId(value)).toBe(false);
  });
});

describe('isDeckName', () => {
  it('accepts names up to the limit', () => {
    expect(isDeckName('a')).toBe(true);
    expect(isDeckName('a'.repeat(MAX_DECK_NAME_LENGTH))).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['too long', 'a'.repeat(MAX_DECK_NAME_LENGTH + 1)],
    ['not a string', null],
  ])('rejects %s', (_label, value) => {
    expect(isDeckName(value)).toBe(false);
  });
});

describe('isDeckCardCount', () => {
  it('accepts 1 to the maximum', () => {
    expect(isDeckCardCount(1)).toBe(true);
    expect(isDeckCardCount(MAX_DECK_CARD_COUNT)).toBe(true);
  });

  it.each([0, -1, 1.5, MAX_DECK_CARD_COUNT + 1, '2', Number.NaN])('rejects %j', (value) => {
    expect(isDeckCardCount(value)).toBe(false);
  });
});

describe('isDeckCard', () => {
  it('accepts a valid slot', () => {
    expect(isDeckCard({ region: 'asia', cardId: 'SV2a-001', count: 4 })).toBe(true);
  });

  it.each([
    ['a region with a colon', { region: 'in:tl', cardId: 'x', count: 1 }],
    ['a long region', { region: 'r'.repeat(17), cardId: 'x', count: 1 }],
    ['an empty card ID', { region: 'intl', cardId: '', count: 1 }],
    ['a zero count', { region: 'intl', cardId: 'x', count: 0 }],
    ['an array', []],
    ['null', null],
  ])('rejects %s', (_label, value) => {
    expect(isDeckCard(value)).toBe(false);
  });
});

describe('isDeck', () => {
  it('accepts a valid deck, and an empty one', () => {
    expect(isDeck(valid)).toBe(true);
    expect(isDeck({ ...valid, cards: [] })).toBe(true);
  });

  it('accepts formats this build does not know (a newer client may)', () => {
    expect(isDeck({ ...valid, format: 'glc' })).toBe(true);
  });

  it('accepts the most slots allowed', () => {
    const cards = Array.from({ length: MAX_DECK_SLOTS }, (_, i) => ({
      region: 'intl',
      cardId: `c-${String(i)}`,
      count: 1,
    }));
    expect(isDeck({ ...valid, cards })).toBe(true);
    expect(
      isDeck({ ...valid, cards: [...cards, { region: 'intl', cardId: 'one-more', count: 1 }] })
    ).toBe(false);
  });

  it('rejects a printing listed twice', () => {
    const card = { region: 'intl', cardId: 'sv03-125', count: 1 };
    expect(isDeck({ ...valid, cards: [card, { ...card, count: 2 }] })).toBe(false);
  });

  it('allows the same card ID in two regions', () => {
    expect(
      isDeck({
        ...valid,
        cards: [
          { region: 'intl', cardId: 'x', count: 1 },
          { region: 'asia', cardId: 'x', count: 1 },
        ],
      })
    ).toBe(true);
  });

  it.each([
    ['a bad ID', { ...valid, id: 'a:b' }],
    ['a blank name', { ...valid, name: ' ' }],
    ['an empty format', { ...valid, format: '' }],
    ['a format with a colon', { ...valid, format: 'a:b' }],
    ['a zone-less timestamp', { ...valid, createdAt: '2026-11-19T10:00:00.000' }],
    ['a timestamp without milliseconds', { ...valid, updatedAt: '2026-11-19T10:00:00Z' }],
    ['an impossible date', { ...valid, updatedAt: '2026-13-45T10:00:00.000Z' }],
    ['cards that are not an array', { ...valid, cards: {} }],
    ['a bad slot', { ...valid, cards: [{ region: 'intl', cardId: 'x', count: 100 }] }],
    ['a missing field', { ...valid, name: undefined }],
    ['an array', [valid]],
    ['null', null],
  ])('rejects %s', (_label, value) => {
    expect(isDeck(value)).toBe(false);
  });
});

describe('deck covers', () => {
  it('accepts a deck with or without a valid cover', () => {
    expect(isDeck({ ...valid, cover: { region: 'intl', cardId: 'sv03-125' } })).toBe(true);
    expect(isDeck(valid)).toBe(true);
  });

  it.each([
    ['null', null],
    ['a region with a colon', { region: 'a:b', cardId: 'x' }],
    ['an empty card ID', { region: 'intl', cardId: '' }],
    ['a string', 'intl:sv03-125'],
  ])('rejects a cover that is %s', (_label, cover) => {
    expect(isDeck({ ...valid, cover })).toBe(false);
    expect(isDeckCover(cover)).toBe(false);
  });

  it('copies a cover’s fields, and adds none when there isn’t one', () => {
    const covered = { ...valid, cover: { region: 'intl', cardId: 'sv03-125', extra: 1 } };
    expect(deck(covered).cover).toEqual({ region: 'intl', cardId: 'sv03-125' });
    expect(deck(valid)).not.toHaveProperty('cover');
  });
});

describe('deck considering', () => {
  const pile = [
    { region: 'intl', cardId: 'sv03-125', count: 1 },
    { region: 'intl', cardId: 'sv02-160', count: 2 },
  ];

  it('accepts a deck with or without a valid pile, sharing printings with its cards', () => {
    expect(isDeck({ ...valid, considering: pile })).toBe(true);
    expect(isDeck({ ...valid, considering: [] })).toBe(true);
    expect(isDeck(valid)).toBe(true);
  });

  it.each([
    ['null', null],
    ['not an array', {}],
    ['a bad slot', [{ region: 'intl', cardId: 'x', count: 0 }]],
    ['a printing twice', [pile[0], { ...pile[0], count: 2 }]],
    [
      'too many printings',
      Array.from({ length: MAX_DECK_SLOTS + 1 }, (_, i) => ({
        region: 'intl',
        cardId: `c${String(i)}`,
        count: 1,
      })),
    ],
  ])('rejects a pile that is %s', (_label, considering) => {
    expect(isDeck({ ...valid, considering })).toBe(false);
  });

  it('copies a pile’s slot fields, and leaves out an empty or missing one', () => {
    const extra = { ...valid, considering: [{ ...pile[0], extra: true }] };
    expect(deck(extra).considering).toEqual([pile[0]]);
    expect(deck({ ...valid, considering: [] })).not.toHaveProperty('considering');
    expect(deck(valid)).not.toHaveProperty('considering');
  });
});

describe('deck', () => {
  it('copies only deck fields', () => {
    const extra = {
      ...valid,
      notes: 'dropped',
      cards: [{ region: 'intl', cardId: 'sv03-125', count: 3, extra: true }],
    };
    expect(deck(extra)).toEqual({
      ...valid,
      cards: [{ region: 'intl', cardId: 'sv03-125', count: 3 }],
    });
  });

  it('returns a copy that does not share the cards array', () => {
    const copy = deck(valid);
    expect(copy.cards).not.toBe(valid.cards);
    expect(copy.cards[0]).not.toBe(valid.cards[0]);
  });
});
