import type { CatalogCard, CatalogSet } from '@pokepaper/shared';
import { setContentHash, stableStringify } from './store.js';
import { memoryCatalogStore } from './test-helpers.js';

const set = (overrides: Partial<CatalogSet> = {}): CatalogSet => ({
  region: 'intl',
  id: 'sv01',
  serieId: 'sv',
  releaseDate: '2023-03-31',
  cardCount: { total: 2, official: 2 },
  abbreviation: 'SVI',
  names: { en: 'Scarlet & Violet' },
  logos: {},
  symbol: null,
  legal: { standard: false, expanded: true },
  languages: ['en'],
  ...overrides,
});

const card = (
  id: string,
  sortIndex: number,
  overrides: Partial<CatalogCard> = {}
): CatalogCard => ({
  region: 'intl',
  id,
  setId: 'sv01',
  localId: id.slice(-3),
  sortIndex,
  category: 'Pokemon',
  rarity: null,
  hp: null,
  types: [],
  stage: null,
  suffix: null,
  trainerType: null,
  energyType: null,
  dexIds: [],
  retreat: null,
  regulationMark: null,
  illustrator: null,
  variants: { normal: true, reverse: false, holo: false, firstEdition: false, wPromo: false },
  legal: { standard: false, expanded: false },
  weaknesses: [],
  resistances: [],
  attacks: [],
  text: {
    en: {
      name: id,
      description: null,
      effect: null,
      evolveFrom: null,
      attacks: [],
      abilities: [],
      image: null,
    },
  },
  ...overrides,
});

describe('stableStringify / setContentHash', () => {
  it('ignores key order and card order', () => {
    expect(stableStringify({ b: 1, a: { d: [2, { f: 1, e: 0 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,{"e":0,"f":1}]},"b":1}'
    );
    expect(setContentHash(set(), [card('sv01-001', 0), card('sv01-002', 1)])).toBe(
      setContentHash(set(), [card('sv01-002', 1), card('sv01-001', 0)])
    );
    expect(setContentHash(set(), [card('sv01-001', 0)])).not.toBe(
      setContentHash(set({ abbreviation: 'X' }), [card('sv01-001', 0)])
    );
  });
});

describe('CatalogStore', () => {
  it('writes a set with its cards and bumps the version only on change', () => {
    const store = memoryCatalogStore();

    expect(store.writeSet(set(), [card('sv01-002', 1), card('sv01-001', 0)])).toBe(true);
    expect(store.version()).toBe(1);
    expect(store.writeSet(set(), [card('sv01-001', 0), card('sv01-002', 1)])).toBe(false);
    expect(store.version()).toBe(1);

    expect(store.listSetCards('intl', 'sv01').map((entry) => entry.id)).toEqual([
      'sv01-001',
      'sv01-002',
    ]);
    expect(store.getSet('intl', 'sv01')?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('replaces a set’s cards, removing ones no longer listed', () => {
    const store = memoryCatalogStore();
    store.writeSet(set(), [card('sv01-001', 0), card('sv01-002', 1)]);

    store.writeSet(set(), [card('sv01-002', 0)]);

    expect(store.listSetCards('intl', 'sv01').map((entry) => entry.id)).toEqual(['sv01-002']);
    expect(store.version()).toBe(2);
  });

  it('moves a card that changed sets', () => {
    const store = memoryCatalogStore();
    store.writeSet(set(), [card('sv01-001', 0)]);

    store.writeSet(set({ id: 'svp' }), [card('sv01-001', 0, { setId: 'svp' })]);

    expect(store.listSetCards('intl', 'svp').map((entry) => entry.id)).toEqual(['sv01-001']);
  });

  it('keeps regions apart even with the same IDs', () => {
    const store = memoryCatalogStore();
    store.writeSet(set({ id: 'neo1' }), [card('neo1-1', 0, { setId: 'neo1' })]);
    store.writeSet(set({ region: 'asia', id: 'neo1' }), [
      card('neo1-1', 0, { region: 'asia', setId: 'neo1' }),
    ]);

    expect(store.listSetIds('intl')).toEqual(['neo1']);
    expect(store.listSetIds('asia')).toEqual(['neo1']);
  });

  it('deletes a set together with its cards', () => {
    const store = memoryCatalogStore();
    store.writeSet(set(), [card('sv01-001', 0)]);

    expect(store.deleteSet('intl', 'sv01')).toBe(true);
    expect(store.deleteSet('intl', 'sv01')).toBe(false);
    expect(store.listSetCards('intl', 'sv01')).toEqual([]);
    expect(store.version()).toBe(2);
  });

  it('replaces series, reporting whether anything changed', () => {
    const store = memoryCatalogStore();
    const sv = { region: 'intl' as const, id: 'sv', names: { en: 'S&V' }, logos: {} };
    const swsh = { region: 'intl' as const, id: 'swsh', names: { en: 'S&S' }, logos: {} };

    expect(store.replaceSeries('intl', [sv, swsh])).toBe(true);
    expect(store.replaceSeries('intl', [sv, swsh])).toBe(false);
    expect(store.replaceSeries('intl', [sv])).toBe(true);
    expect(store.listSeries('intl')).toEqual([sv]);
    expect(store.version()).toBe(2);
  });

  it('builds the manifest and set packs', () => {
    const store = memoryCatalogStore();
    store.replaceSeries('intl', [{ region: 'intl', id: 'sv', names: { en: 'S&V' }, logos: {} }]);
    store.writeSet(set(), [card('sv01-002', 1), card('sv01-001', 0)]);
    const hash = store.getSet('intl', 'sv01')?.hash ?? '';

    expect(store.manifest(['en'])).toEqual({
      version: 2,
      languages: ['en'],
      series: [{ region: 'intl', id: 'sv', names: { en: 'S&V' }, logos: {} }],
      sets: [{ region: 'intl', id: 'sv01', hash, cardCount: 2 }],
    });
    expect(store.getSetPack('intl', 'sv01')).toEqual({
      hash,
      set: set(),
      cards: [card('sv01-001', 0), card('sv01-002', 1)],
    });
    expect(store.getSetPack('intl', 'nope')).toBeUndefined();
    expect(store.getCard('intl', 'sv01-002')?.sortIndex).toBe(1);
    expect(store.getCard('asia', 'sv01-002')).toBeUndefined();
  });

  it('remembers image checks', () => {
    const store = memoryCatalogStore();
    const at = new Date('2026-01-01T00:00:00Z');

    expect(store.getImageProbe('ja/SV/SV2a/001')).toBeUndefined();
    store.saveImageProbe('ja/SV/SV2a/001', false, at);
    store.saveImageProbe('ja/SV/SV2a/001', true, at);

    expect(store.getImageProbe('ja/SV/SV2a/001')).toEqual({ found: true, checkedAt: at });
  });

  it('saves and loads learned vocabulary', () => {
    const store = memoryCatalogStore();

    expect(store.getVocabulary('fr').size).toBe(0);
    store.saveVocabulary('fr', new Map([['Plante', 'Grass']]));

    expect(store.getVocabulary('fr').get('Plante')).toBe('Grass');
  });

  it('tracks runs, counting partial full refreshes and abandoning interrupted ones', () => {
    const store = memoryCatalogStore();
    const light = store.startRun('light', new Date('2026-01-01T00:00:00Z'));
    store.finishRun(light, 'ok', {}, new Date('2026-01-01T00:10:00Z'));
    expect(store.lastCompletedFullRun()).toBeNull();

    const full = store.startRun('full', new Date('2026-01-02T00:00:00Z'));
    store.finishRun(full, 'partial', {}, new Date('2026-01-02T01:00:00Z'));
    expect(store.lastCompletedFullRun()).toEqual(new Date('2026-01-02T01:00:00Z'));

    store.startRun('full', new Date('2026-01-03T00:00:00Z'));
    store.abandonRunningRuns(new Date('2026-01-03T00:05:00Z'));
    expect(store.lastCompletedFullRun()).toEqual(new Date('2026-01-02T01:00:00Z'));
  });
});
