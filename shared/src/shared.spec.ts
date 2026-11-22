import {
  basicEnergyType,
  basicEnergyTypeOf,
  CATALOG_LANGUAGES,
  CARDMARKET_LANGUAGE_IDS,
  cardmarketProductUrl,
  catalogCardImageUrl,
  DEFAULT_SETTINGS,
  isExchangeRates,
  isSyncEntityType,
  isUserSettings,
  knownCatalogLanguages,
  SYNC_ENTITY_TYPES,
} from './index';

describe('isSyncEntityType', () => {
  it('accepts every declared entity type and rejects anything else', () => {
    for (const type of SYNC_ENTITY_TYPES) {
      expect(isSyncEntityType(type)).toBe(true);
    }
    expect(isSyncEntityType('decks')).toBe(false);
    expect(isSyncEntityType(42)).toBe(false);
  });
});

describe('isUserSettings', () => {
  it('accepts the defaults', () => {
    expect(isUserSettings(DEFAULT_SETTINGS)).toBe(true);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'en'],
    ['a missing language', {}],
    ['an empty language', { cardLanguage: '' }],
    ['a non-string language', { cardLanguage: 3 }],
    ['an oversized language', { cardLanguage: 'x'.repeat(17) }],
    ['catalog languages that are not an object', { cardLanguage: 'en', catalogLanguages: 'de' }],
    ['a non-string catalog language', { cardLanguage: 'en', catalogLanguages: { intl: 3 } }],
    ['an empty catalog language', { cardLanguage: 'en', catalogLanguages: { intl: '' } }],
    [
      'an oversized catalog language',
      { cardLanguage: 'en', catalogLanguages: { intl: 'x'.repeat(17) } },
    ],
    [
      'too many catalog languages',
      {
        cardLanguage: 'en',
        catalogLanguages: Object.fromEntries(
          Array.from({ length: 9 }, (_, index) => [`r${String(index)}`, 'en'])
        ),
      },
    ],
    ['a currency in lowercase', { cardLanguage: 'en', currency: 'chf' }],
    ['a currency that is not a code', { cardLanguage: 'en', currency: 'Swiss franc' }],
    ['a non-string currency', { cardLanguage: 'en', currency: 756 }],
  ])('rejects %s', (_label, value) => {
    expect(isUserSettings(value)).toBe(false);
  });

  it('accepts a currency, including ones this build has no rate for', () => {
    expect(isUserSettings({ cardLanguage: 'en', currency: 'CHF' })).toBe(true);
    expect(isUserSettings({ cardLanguage: 'en', currency: 'XYZ' })).toBe(true);
  });

  it('accepts per-catalog languages, and older payloads without them', () => {
    expect(
      isUserSettings({ cardLanguage: 'en', catalogLanguages: { intl: 'de', asia: 'zh-tw' } })
    ).toBe(true);
    expect(isUserSettings({ cardLanguage: 'en', catalogLanguages: { asia: 'ja' } })).toBe(true);
    expect(isUserSettings({ cardLanguage: 'ko' })).toBe(true);
  });

  it('accepts catalogs and languages from newer clients, which this build ignores', () => {
    const settings = {
      cardLanguage: 'en',
      catalogLanguages: { intl: 'de', asia: 'ko', eu: 'es', kr: 'ko' },
    };

    expect(isUserSettings(settings)).toBe(true);
    expect(knownCatalogLanguages(settings)).toEqual({ intl: 'de' });
    expect(knownCatalogLanguages({ cardLanguage: 'en', catalogLanguages: { intl: 'ja' } })).toEqual(
      {}
    );
  });
});

describe('isExchangeRates', () => {
  it('accepts ECB rates', () => {
    expect(isExchangeRates({ date: '2026-11-20', rates: { CHF: 0.9223, JPY: 174.35 } })).toBe(true);
    expect(isExchangeRates({ date: '2026-11-20', rates: {} })).toBe(true);
  });

  it.each([
    ['null', null],
    ['no date', { rates: { CHF: 1 } }],
    ['a date that is not a day', { date: 'Nov 20', rates: { CHF: 1 } }],
    ['rates that are not an object', { date: '2026-11-20', rates: [1] }],
    ['a code that is not one', { date: '2026-11-20', rates: { chf: 1 } }],
    ['a rate for the euro', { date: '2026-11-20', rates: { EUR: 1 } }],
    ['a zero rate', { date: '2026-11-20', rates: { CHF: 0 } }],
    ['a rate that is not a number', { date: '2026-11-20', rates: { CHF: '0.92' } }],
  ])('rejects %s', (_label, value) => {
    expect(isExchangeRates(value)).toBe(false);
  });
});

describe('basicEnergyType', () => {
  it('reads the type from a basic Energy’s English name', () => {
    expect(basicEnergyType('Fire Energy')).toBe('Fire');
    expect(basicEnergyType('Basic Metal Energy')).toBe('Metal');
    expect(basicEnergyType(' Fairy  Energy ')).toBe('Fairy');
  });

  it('is null for special Energy and anything else', () => {
    for (const name of [
      'Prism Energy',
      'Ignition Energy',
      'Double Colorless Energy',
      'Fire',
      'Energy Search',
      'δ Rainbow Energy',
    ]) {
      expect(basicEnergyType(name)).toBeNull();
    }
  });
});

describe('catalogCardImageUrl', () => {
  it('names a borrowed scan’s source, and nothing for a card’s own', () => {
    const own = { region: 'intl' as const, id: 'sv01-001' };
    expect(catalogCardImageUrl(own, 'en', 'low')).toBe(
      '/images/catalog/cards/intl/sv01-001/en/low.webp'
    );
    const borrowed = {
      ...own,
      text: {
        en: {
          name: 'Fire Energy',
          description: null,
          effect: null,
          evolveFrom: null,
          attacks: [],
          abilities: [],
          image: 'en/sv/sve/2',
          imageFrom: 'sve 2',
        },
      },
    };
    expect(catalogCardImageUrl(borrowed, 'en', 'high')).toBe(
      '/images/catalog/cards/intl/sv01-001/en/high.webp?from=sve%202'
    );
  });
});

describe('cardmarketProductUrl', () => {
  const page = 'https://www.cardmarket.com/en/Pokemon/Products';

  it('opens a product’s page with every offer', () => {
    expect(cardmarketProductUrl(483559)).toBe(`${page}?idProduct=483559`);
  });

  it('filters the offers to a language and to reverse holos', () => {
    expect(cardmarketProductUrl(483559, { language: 'de' })).toBe(
      `${page}?idProduct=483559&language=3`
    );
    expect(cardmarketProductUrl(483559, { reverseHolo: true })).toBe(
      `${page}?idProduct=483559&isReverseHolo=Y`
    );
    expect(cardmarketProductUrl(483559, { language: 'de', reverseHolo: true })).toBe(
      `${page}?idProduct=483559&language=3&isReverseHolo=Y`
    );
  });

  it('knows a distinct Cardmarket language for every catalog language', () => {
    const ids = CATALOG_LANGUAGES.map((language) => CARDMARKET_LANGUAGE_IDS[language]);
    expect(new Set(ids).size).toBe(CATALOG_LANGUAGES.length);
  });
});

describe('basicEnergyTypeOf', () => {
  const text = (name: string) => ({
    en: {
      name,
      description: null,
      effect: null,
      evolveFrom: null,
      attacks: [],
      abilities: [],
      image: null,
    },
  });

  it('needs both a basic energyType and a basic Energy name', () => {
    expect(
      basicEnergyTypeOf({
        category: 'Energy',
        energyType: 'Normal',
        text: text('Basic Fire Energy'),
      })
    ).toBe('Fire');
    // Old special Energy share the name; TCGdex marks Prism Energy basic.
    expect(
      basicEnergyTypeOf({
        category: 'Energy',
        energyType: 'Special',
        text: text('Darkness Energy'),
      })
    ).toBeNull();
    expect(
      basicEnergyTypeOf({ category: 'Energy', energyType: 'Normal', text: text('Prism Energy') })
    ).toBeNull();
    expect(
      basicEnergyTypeOf({ category: 'Trainer', energyType: 'Normal', text: text('Fire Energy') })
    ).toBeNull();
    expect(basicEnergyTypeOf({ category: 'Energy', energyType: 'Normal', text: {} })).toBeNull();
  });
});
