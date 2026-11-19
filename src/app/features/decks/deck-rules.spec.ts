import type { CatalogCard, Deck } from '@pokepaper/shared';
import { makeContractCard } from '../../core/data/storage-engine.contract';
import {
  checkDeck,
  englishName,
  isAceSpec,
  isBanned,
  isBasicEnergy,
  isPrismStar,
  isRadiant,
  nameTotal,
  printingLegal,
  ruleName,
  rulesFingerprint,
  type CheckedCard,
} from './deck-rules';

/** A card's English text (the contract card always has it). */
function englishText(entry: CatalogCard): NonNullable<CatalogCard['text']['en']> {
  const text = entry.text.en;
  if (!text) {
    throw new Error(`No English text for ${entry.id}`);
  }
  return text;
}

/** A card with an English name and overrides; the contract card is a Basic Grass Pokémon. */
function card(id: string, name: string, overrides: Partial<CatalogCard> = {}): CatalogCard {
  const base = makeContractCard('intl', id.split('-')[0] ?? 'set', id, 0);
  return {
    ...base,
    regulationMark: 'H',
    ...overrides,
    text: { en: { ...englishText(base), name }, ...overrides.text },
  };
}

const trainer = (id: string, name: string, overrides: Partial<CatalogCard> = {}) =>
  card(id, name, { category: 'Trainer', trainerType: 'Item', stage: null, hp: null, ...overrides });
const basicEnergy = (id: string, name = 'Fire Energy') =>
  card(id, name, {
    category: 'Energy',
    energyType: 'Normal',
    stage: null,
    hp: null,
    regulationMark: null,
  });

describe('names', () => {
  it('uses the English name, tidied, or another language without one', () => {
    expect(englishName(card('sv01-1', 'Lt. Surge’s  Strategy'))).toBe("Lt. Surge's Strategy");
    const french = card('fr-1', 'x', {
      text: { fr: { ...englishText(card('a', 'b')), name: 'Pikachu' } },
    });
    delete (french.text as Record<string, unknown>)['en'];
    expect(englishName(french)).toBe('Pikachu');
  });

  it('counts by name without a level or δ, keeping suffixes, owners and forms', () => {
    expect(ruleName(card('dp-1', 'Gengar LV.X'))).toBe('Gengar');
    expect(ruleName(card('dp-2', 'Gengar LV. 43'))).toBe('Gengar');
    expect(ruleName(card('ex-1', 'Beedrill δ'))).toBe('Beedrill');
    expect(ruleName(card('sv-1', 'Miraidon ex'))).toBe('Miraidon ex');
    expect(ruleName(card('sm-1', 'Alolan Meowth'))).toBe('Alolan Meowth');
    expect(ruleName(card('pl-1', 'Luxray GL LV.X'))).toBe('Luxray GL');
  });
});

describe('card kinds', () => {
  it('tells basic Energy from special Energy', () => {
    expect(isBasicEnergy(basicEnergy('sve-2'))).toBe(true);
    expect(
      isBasicEnergy(card('sv-9', 'Jet Energy', { category: 'Energy', energyType: 'Special' }))
    ).toBe(false);
  });

  it('finds ACE SPEC cards by rarity, and Black & White ones by printing', () => {
    expect(isAceSpec(trainer('sv05-157', 'Prime Catcher', { rarity: 'ACE SPEC Rare' }))).toBe(true);
    expect(isAceSpec(trainer('bw7-137', 'Computer Search', { rarity: 'Rare' }))).toBe(true);
    expect(isAceSpec(trainer('base1-71', 'Computer Search', { rarity: 'Rare' }))).toBe(false);
  });

  it('finds Radiant Pokémon by rarity or name, and Prism Star cards by ◇', () => {
    expect(isRadiant(card('swsh10-46', 'Radiant Greninja', { rarity: 'Radiant Rare' }))).toBe(true);
    expect(isRadiant(card('pgo-1', 'Radiant Charizard'))).toBe(true);
    expect(isRadiant(card('sv-1', 'Greninja'))).toBe(false);
    expect(isPrismStar(card('sm7-1', 'Giratina ◇'))).toBe(true);
    expect(isPrismStar(card('sm7-2', 'Giratina'))).toBe(false);
  });
});

describe('rulesFingerprint', () => {
  it('matches reprints whatever their set, number, mark, art or rarity', () => {
    const a = trainer('sv01-196', 'Ultra Ball', {
      regulationMark: 'G',
      illustrator: 'A',
      rarity: 'Uncommon',
    });
    const b = trainer('me01-131', 'Ultra Ball', {
      regulationMark: 'I',
      illustrator: 'B',
      rarity: 'Common',
      localId: '131',
    });
    expect(rulesFingerprint(a)).toBe(rulesFingerprint(b));
  });

  it('tells apart cards whose name or rules text differ', () => {
    const a = trainer('x-1', 'Ultra Ball');
    const withEffect = (effect: string) =>
      trainer('x-2', 'Ultra Ball', { text: { en: { ...englishText(a), effect } } });
    expect(rulesFingerprint(withEffect('Discard 2 cards.'))).not.toBe(
      rulesFingerprint(withEffect('Discard 1 card.'))
    );
    expect(rulesFingerprint(card('x-3', 'Pikachu'))).not.toBe(
      rulesFingerprint(card('x-4', 'Pikachu ex'))
    );
    expect(rulesFingerprint(card('x-5', 'Pikachu', { hp: 70 }))).not.toBe(
      rulesFingerprint(card('x-6', 'Pikachu', { hp: 60 }))
    );
  });
});

describe('printingLegal', () => {
  it('allows Standard marks H, I and J only', () => {
    for (const [mark, legal] of [
      ['G', false],
      ['H', true],
      ['I', true],
      ['J', true],
      ['F', false],
    ] as const) {
      expect(printingLegal(card('x-1', 'X', { regulationMark: mark }), 'sv', 'standard')).toBe(
        legal
      );
    }
    expect(printingLegal(card('x-1', 'X', { regulationMark: 'j' }), 'me', 'standard')).toBe(true);
  });

  it('allows Expanded marks D to J, Black & White to Sun & Moon sets, and the extra releases', () => {
    expect(printingLegal(card('swsh1-1', 'X', { regulationMark: 'D' }), 'swsh', 'expanded')).toBe(
      true
    );
    expect(printingLegal(card('xy1-1', 'X', { regulationMark: null }), 'xy', 'expanded')).toBe(
      true
    );
    expect(printingLegal(card('dp1-1', 'X', { regulationMark: null }), 'dp', 'expanded')).toBe(
      false
    );
    expect(
      printingLegal(
        card('2011bw-1', 'X', { setId: '2011bw', regulationMark: null }),
        'mc',
        'expanded'
      )
    ).toBe(true);
    expect(
      printingLegal(
        card('2022swsh-1', 'X', { setId: '2022swsh', regulationMark: null }),
        'mc',
        'expanded'
      )
    ).toBe(false);
    expect(
      printingLegal(
        card('tk-xy-b-1', 'X', { setId: 'tk-xy-b', regulationMark: null }),
        'tk',
        'expanded'
      )
    ).toBe(true);
    expect(
      printingLegal(
        card('tk-dp-l-1', 'X', { setId: 'tk-dp-l', regulationMark: null }),
        'tk',
        'expanded'
      )
    ).toBe(false);
  });

  it('counts SM promos from SM158, and every BW and XY promo', () => {
    const promo = (setId: string, localId: string) =>
      card(`${setId}-${localId}`, 'X', { setId, localId, regulationMark: null });
    expect(printingLegal(promo('smp', 'SM157'), 'sm', 'expanded')).toBe(false);
    expect(printingLegal(promo('smp', 'SM158'), 'sm', 'expanded')).toBe(true);
    expect(printingLegal(promo('xyp', 'XY01'), 'xy', 'expanded')).toBe(true);
    expect(printingLegal(promo('bwp', 'BW01'), 'bw', 'expanded')).toBe(true);
  });

  it('uses TCGdex’s flags for a mark missing from the data in a series that prints them', () => {
    const unmarked = card('me06-1', 'X', {
      regulationMark: null,
      legal: { standard: true, expanded: true },
    });
    expect(printingLegal(unmarked, 'me', 'standard')).toBe(true);
    expect(
      printingLegal(
        { ...unmarked, regulationMark: 'None', legal: { standard: false, expanded: true } },
        'sv',
        'standard'
      )
    ).toBe(false);
  });

  it('always allows basic Energy, and never TCG Pocket cards', () => {
    expect(printingLegal(basicEnergy('base1-98'), 'base', 'standard')).toBe(true);
    expect(
      printingLegal(trainer('A3-144', 'Rare Candy', { regulationMark: 'H' }), 'tcgp', 'standard')
    ).toBe(false);
  });
});

describe('isBanned', () => {
  it('bans listed printings in Expanded only', () => {
    const unown = card('sm8-90', 'Unown', { setId: 'sm8' });
    expect(isBanned(unown, 'expanded')).toBe(true);
    expect(isBanned(unown, 'standard')).toBe(false);
    expect(isBanned(unown, 'unlimited')).toBe(false);
    expect(isBanned(card('sm8-92', 'Unown', { setId: 'sm8' }), 'expanded')).toBe(false);
  });
});

describe('checkDeck', () => {
  const legal = { standard: true, expanded: true };
  const checked = (entry: CatalogCard, overrides: Partial<CheckedCard> = {}): CheckedCard => ({
    card: entry,
    serie: 'sv',
    legal,
    ...overrides,
  });
  const deckOf = (
    slots: [CatalogCard, number][],
    format = 'standard'
  ): {
    deck: Deck;
    cards: Map<string, CheckedCard>;
  } => ({
    deck: {
      id: 'd',
      name: 'Deck',
      format,
      cards: slots.map(([entry, count]) => ({ region: entry.region, cardId: entry.id, count })),
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    cards: new Map(slots.map(([entry]) => [`${entry.region}:${entry.id}`, checked(entry)])),
  });
  const ids = (deck: Deck, cards: Map<string, CheckedCard>) =>
    checkDeck(deck, cards).issues.map((issue) => issue.id);

  const pikachu = card('sv01-1', 'Pikachu');
  const energy = basicEnergy('sve-2');

  it('passes a legal 60-card deck', () => {
    const { deck, cards } = deckOf([
      [pikachu, 4],
      [energy, 56],
    ]);

    expect(checkDeck(deck, cards)).toMatchObject({ format: 'standard', issues: [] });
  });

  it('says how many cards a deck has when it isn’t 60', () => {
    const { deck, cards } = deckOf([
      [pikachu, 4],
      [energy, 10],
    ]);

    expect(checkDeck(deck, cards).issues).toEqual([{ id: 'size', text: '14 of 60 cards' }]);
  });

  it('counts names across printings and levels, exempting basic Energy, and notes the cards', () => {
    const gengar = card('dp1-1', 'Gengar');
    const gengarX = card('dp2-1', 'Gengar LV.X');
    const { deck, cards } = deckOf([
      [gengar, 3],
      [gengarX, 2],
      [energy, 55],
    ]);

    const check = checkDeck(deck, cards);
    expect(check.issues).toEqual([
      { id: 'copies:Gengar', text: '5 cards named Gengar (4 allowed)' },
    ]);
    expect(check.cardNotes.get('intl:dp1-1')).toEqual(['5 named Gengar, 4 allowed']);
    expect(check.limits.get('intl:dp2-1')).toEqual({ name: 'Gengar', total: 5, limit: 4 });
    expect(check.limits.get('intl:sve-2')).toEqual({ name: 'Fire Energy', total: 55, limit: 99 });
  });

  it('allows one of each Prism Star card, one ACE SPEC and one Radiant Pokémon in total', () => {
    const giratina = card('sm7-1', 'Giratina ◇');
    const catcher = trainer('sv05-157', 'Prime Catcher', { rarity: 'ACE SPEC Rare' });
    const search = trainer('bw7-137', 'Computer Search', { rarity: 'Rare' });
    const greninja = card('swsh10-46', 'Radiant Greninja', { rarity: 'Radiant Rare' });
    const charizard = card('pgo-11', 'Radiant Charizard', { rarity: 'Radiant Rare' });
    const { deck, cards } = deckOf([
      [giratina, 2],
      [catcher, 1],
      [search, 1],
      [greninja, 1],
      [charizard, 1],
      [energy, 54],
    ]);

    expect(checkDeck(deck, cards).issues.map((issue) => issue.text)).toEqual([
      '2 cards named Giratina ◇ (1 allowed)',
      '2 ACE SPEC cards (1 allowed)',
      '2 Radiant Pokémon (1 allowed)',
    ]);
  });

  it('needs a Basic Pokémon, but only says so when every card could be checked', () => {
    const { deck, cards } = deckOf([
      [trainer('sv01-2', 'Nest Ball'), 4],
      [energy, 56],
    ]);
    expect(ids(deck, cards)).toEqual(['basic']);

    const withUnknown: Deck = {
      ...deck,
      cards: [...deck.cards, { region: 'intl', cardId: 'gone', count: 1 }],
    };
    expect(ids(withUnknown, cards)).toEqual(['size', 'unknown']);
    expect(checkDeck(withUnknown, cards).cardNotes.get('intl:gone')).toEqual([
      "Can't be checked: not on this device",
    ]);
  });

  it('flags cards not legal in the format, and banned ones in Expanded', () => {
    const old = card('sv01-9', 'Old');
    const unown = card('sm8-90', 'Unown', { setId: 'sm8' });
    const { deck, cards } = deckOf(
      [
        [pikachu, 4],
        [old, 2],
        [unown, 1],
        [energy, 53],
      ],
      'expanded'
    );
    cards.set('intl:sv01-9', checked(old, { legal: { standard: true, expanded: false } }));

    const check = checkDeck(deck, cards);
    expect(check.issues.map((issue) => issue.text)).toEqual([
      '2 cards not legal in Expanded',
      '1 banned card in Expanded',
    ]);
    expect(check.cardNotes.get('intl:sv01-9')).toEqual(['Not legal in Expanded']);
    expect(check.cardNotes.get('intl:sm8-90')).toEqual(['Banned in Expanded']);
  });

  it('flags Japan & Asia printings in Standard and Expanded, not Unlimited', () => {
    const japanese: CatalogCard = { ...card('SV1-1', 'Pikachu'), region: 'asia' };
    const slots: [CatalogCard, number][] = [
      [japanese, 4],
      [energy, 56],
    ];
    const standard = deckOf(slots);
    standard.cards.set(
      'asia:SV1-1',
      checked(japanese, { legal: { standard: false, expanded: false } })
    );

    expect(checkDeck(standard.deck, standard.cards).issues).toEqual([
      { id: 'asian', text: '4 Japan & Asia printings, not tournament-legal' },
    ]);
    expect(standard.cards.size).toBe(2);
    expect(checkDeck({ ...standard.deck, format: 'unlimited' }, standard.cards).issues).toEqual([]);
  });

  it('flags TCG Pocket cards in every format, not as illegal', () => {
    const pocket = trainer('A3-144', 'Rare Candy');
    const { deck, cards } = deckOf(
      [
        [pikachu, 4],
        [pocket, 1],
        [energy, 55],
      ],
      'unlimited'
    );
    cards.set(
      'intl:A3-144',
      checked(pocket, { serie: 'tcgp', legal: { standard: false, expanded: false } })
    );

    expect(checkDeck(deck, cards).issues).toEqual([
      { id: 'pocket', text: '1 TCG Pocket card, digital only' },
    ]);
    expect(ids({ ...deck, format: 'standard' }, cards)).toEqual(['pocket']);
  });

  it('checks a format this build doesn’t know as Unlimited', () => {
    const { deck, cards } = deckOf(
      [
        [pikachu, 4],
        [energy, 56],
      ],
      'glc'
    );
    cards.set('intl:sv01-1', checked(pikachu, { legal: { standard: false, expanded: false } }));

    expect(checkDeck(deck, cards)).toMatchObject({ format: 'unlimited', issues: [] });
  });
});

describe('nameTotal', () => {
  it('sums the copies of a name across printings on this device', () => {
    const a = card('sv01-1', 'Iono', { category: 'Trainer' });
    const b = card('sv02-1', 'Iono', { category: 'Trainer' });
    const deck = {
      cards: [
        { region: 'intl', cardId: 'sv01-1', count: 2 },
        { region: 'intl', cardId: 'sv02-1', count: 1 },
        { region: 'intl', cardId: 'gone', count: 3 },
      ],
    };
    const cards = new Map<string, CheckedCard>([
      ['intl:sv01-1', { card: a, serie: 'sv', legal: { standard: true, expanded: true } }],
      ['intl:sv02-1', { card: b, serie: 'sv', legal: { standard: true, expanded: true } }],
    ]);

    expect(nameTotal(deck, cards, 'Iono')).toBe(3);
    expect(nameTotal(deck, cards, 'Arven')).toBe(0);
  });
});
