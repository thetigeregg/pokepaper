import { DEFAULT_SETTINGS, isSyncEntityType, isUserSettings, SYNC_ENTITY_TYPES } from './index';

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
    ['an unknown catalog region', { cardLanguage: 'en', catalogLanguages: { eu: 'de' } }],
    ['an unsupported language', { cardLanguage: 'en', catalogLanguages: { intl: 'es' } }],
    ['a language from the other region', { cardLanguage: 'en', catalogLanguages: { intl: 'ja' } }],
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
});
