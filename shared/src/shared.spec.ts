import {
  basicEnergyType,
  catalogCardImageUrl,
  DEFAULT_SETTINGS,
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
  ])('rejects %s', (_label, value) => {
    expect(isUserSettings(value)).toBe(false);
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
