import type { CatalogLanguage } from '@pokepaper/shared';
import { runCatalogIngest, type CatalogIngestOptions } from './ingest.js';
import type { CatalogStore } from './store.js';
import {
  fakeClient,
  fakeTcgdex,
  memoryCatalogStore,
  silentLogger,
  Status,
  type FakeTcgdex,
} from './test-helpers.js';

const LANGUAGES: CatalogLanguage[] = ['en', 'fr', 'ja', 'zh-tw'];

function ingest(
  store: CatalogStore,
  fake: FakeTcgdex,
  overrides: Partial<CatalogIngestOptions> = {}
) {
  return runCatalogIngest({
    store,
    client: fakeClient(fake, overrides.signal),
    languages: LANGUAGES,
    kind: 'full',
    log: silentLogger(),
    ...overrides,
  });
}

function card(store: CatalogStore, region: 'intl' | 'asia', setId: string, id: string) {
  return store.listSetCards(region, setId).find((entry) => entry.id === id);
}

describe('runCatalogIngest', () => {
  it('merges every language of a card into one record with canonical vocabulary', async () => {
    const store = memoryCatalogStore();

    const stats = await ingest(store, fakeTcgdex());

    expect(stats).toMatchObject({
      status: 'ok',
      sets: { seen: 3, written: 3, unchanged: 0, empty: 0, failed: 0, removed: 0 },
    });
    expect(card(store, 'intl', 'sv01', 'sv01-001')).toEqual({
      region: 'intl',
      id: 'sv01-001',
      setId: 'sv01',
      localId: '001',
      sortIndex: 0,
      category: 'Pokemon',
      rarity: 'Common',
      hp: 60,
      types: ['Grass'],
      stage: 'Basic',
      suffix: null,
      trainerType: null,
      energyType: null,
      dexIds: [204],
      retreat: 2,
      regulationMark: 'G',
      illustrator: 'Shigenori Negishi',
      variants: { normal: true, reverse: true, holo: false, firstEdition: false, wPromo: false },
      legal: { standard: false, expanded: true },
      weaknesses: [{ type: 'Fire', value: '×2' }],
      resistances: [],
      attacks: [{ cost: ['Colorless', 'Colorless'], damage: '10' }],
      text: {
        en: {
          name: 'Pineco',
          description: 'It spits out a fluid that it uses to glue tree bark to its body.',
          effect: null,
          evolveFrom: null,
          attacks: [{ name: 'Guard Press', effect: null }],
          abilities: [],
          image: 'en/sv/sv01/001',
        },
        fr: {
          name: 'Pomdepik',
          description: 'Il crache un fluide qui lui sert à coller des écorces sur son corps.',
          effect: null,
          evolveFrom: null,
          attacks: [{ name: 'Pression de Garde', effect: null }],
          abilities: [],
          image: 'fr/sv/sv01/001',
        },
      },
    });
  });

  it('maps cards that exist only in French to canonical vocabulary learned from shared cards', async () => {
    const store = memoryCatalogStore();

    await ingest(store, fakeTcgdex());

    expect(card(store, 'intl', '2019sm-fr', '2019sm-fr-1')).toMatchObject({
      category: 'Pokemon',
      rarity: 'Common',
      types: ['Grass'],
      stage: 'Basic',
      weaknesses: [{ type: 'Fire', value: '×2' }],
      attacks: [{ cost: ['Colorless'], damage: '10+' }],
      text: { fr: { name: 'Pomdepik' } },
    });
    expect(Object.fromEntries(store.getVocabulary('fr'))).toMatchObject({
      Plante: 'Grass',
      Commune: 'Common',
      Base: 'Basic',
      Feu: 'Fire',
      Incolore: 'Colorless',
      Pokémon: 'Pokemon',
    });
  });

  it('stores sets, series and the Asian region with their languages', async () => {
    const store = memoryCatalogStore();

    await ingest(store, fakeTcgdex());

    expect(store.getSet('intl', 'sv01')?.set).toMatchObject({
      serieId: 'sv',
      releaseDate: '2023-03-31',
      abbreviation: 'SV01',
      names: { en: 'Scarlet & Violet', fr: 'Écarlate et Violet' },
      logos: { en: 'en/sv/sv01/logo', fr: 'fr/sv/sv01/logo' },
      symbol: 'univ/sv/sv01/symbol',
      languages: ['en', 'fr'],
    });
    expect(store.listSeries('intl')).toEqual([
      { region: 'intl', id: 'misc', names: { fr: 'Divers' }, logos: {} },
      {
        region: 'intl',
        id: 'sv',
        names: { en: 'Scarlet & Violet', fr: 'Écarlate et Violet' },
        logos: { en: 'en/sv/sv01/logo' },
      },
    ]);
    expect(card(store, 'asia', 'SV2a', 'SV2a-001')?.text).toMatchObject({
      ja: { name: 'フシギダネ', image: 'ja/SV/SV2a/001' },
      'zh-tw': { name: '妙蛙種子', image: 'zh-tw/SV/SV2a/001' },
    });
  });

  it('skips languages and cards TCGdex cannot serve without failing the set', async () => {
    const store = memoryCatalogStore();

    const stats = await ingest(store, fakeTcgdex());

    // The French detail of sv01-172 is a 404; SV2a-002 has no name.
    expect(Object.keys(card(store, 'intl', 'sv01', 'sv01-172')?.text ?? {})).toEqual(['en']);
    expect(card(store, 'asia', 'SV2a', 'SV2a-002')).toBeUndefined();
    expect(stats.cards.skipped).toBe(2);
  });

  it('fetches only listings on a light pass when nothing is new', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    await ingest(store, fake);
    const version = store.version();
    fake.calls.length = 0;

    const stats = await ingest(store, fake, { kind: 'light' });

    // Only the cards that 404'd or were malformed are tried again.
    expect(fake.calls.filter((path) => path.includes('/cards/'))).toEqual([
      '/fr/cards/sv01-172',
      '/ja/cards/SV2a-002',
    ]);
    expect(stats.sets).toMatchObject({ written: 0, unchanged: 3 });
    expect(store.version()).toBe(version);
  });

  it('adds new cards on a light pass, fetching only them', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    await ingest(store, fake);
    const version = store.version();
    const detail = fake.routes.get('/en/sets/sv01') as { cards: unknown[] };
    detail.cards.push({ id: 'sv01-002', localId: '002', name: 'x' });
    fake.routes.set('/en/cards/sv01-002', {
      id: 'sv01-002',
      localId: '002',
      name: 'Shuckle',
      category: 'Pokemon',
    });
    fake.calls.length = 0;

    const stats = await ingest(store, fake, { kind: 'light' });

    expect(fake.calls).toContain('/en/cards/sv01-002');
    expect(fake.calls).not.toContain('/en/cards/sv01-001');
    expect(stats.sets.written).toBe(1);
    expect(store.listSetCards('intl', 'sv01').map((entry) => entry.id)).toEqual([
      'sv01-001',
      'sv01-172',
      'sv01-002',
    ]);
    expect(store.version()).toBeGreaterThan(version);
  });

  it('picks up corrections to existing cards on a full refresh', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    await ingest(store, fake);
    const pineco = fake.routes.get('/en/cards/sv01-001') as { name: string };
    pineco.name = 'Pineco (corrected)';

    await ingest(store, fake, { kind: 'light' });
    expect(card(store, 'intl', 'sv01', 'sv01-001')?.text.en?.name).toBe('Pineco');

    await ingest(store, fake, { kind: 'full' });
    expect(card(store, 'intl', 'sv01', 'sv01-001')?.text.en?.name).toBe('Pineco (corrected)');
  });

  it('removes sets and cards TCGdex no longer lists', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    await ingest(store, fake);
    fake.routes.set('/fr/sets', [{ id: 'sv01' }]);
    for (const language of ['en', 'fr']) {
      const detail = fake.routes.get(`/${language}/sets/sv01`) as { cards: { id: string }[] };
      detail.cards = detail.cards.filter((entry) => entry.id !== 'sv01-172');
    }

    const stats = await ingest(store, fake, { kind: 'light' });

    expect(stats.sets.removed).toBe(1);
    expect(store.getSet('intl', '2019sm-fr')).toBeUndefined();
    expect(store.listSetCards('intl', 'sv01').map((entry) => entry.id)).toEqual(['sv01-001']);
  });

  it('does not store sets TCGdex lists without any cards, and drops ones that become empty', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    await ingest(store, fake);
    (fake.routes.get('/fr/sets/2019sm-fr') as { cards: unknown[] }).cards = [];

    const stats = await ingest(store, fake, { kind: 'light' });

    expect(stats.sets).toMatchObject({ empty: 1, removed: 1 });
    expect(store.getSet('intl', '2019sm-fr')).toBeUndefined();
  });

  it('keeps a set’s previous data when TCGdex is unavailable for it', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    await ingest(store, fake);
    const before = store.listSetCards('intl', 'sv01');
    fake.routes.set('/en/cards/sv01-001', new Status(503));
    fake.calls.length = 0;
    const log = silentLogger();

    const stats = await ingest(store, fake, { kind: 'full', log });

    expect(stats.status).toBe('partial');
    expect(stats.sets.failed).toBe(1);
    expect(store.listSetCards('intl', 'sv01')).toEqual(before);
    expect(log.warnings).toContain('catalog.set_failed');
    // Retried before giving up.
    expect(fake.calls.filter((path) => path === '/en/cards/sv01-001')).toHaveLength(4);
  });

  it('leaves a region untouched when its listings cannot be loaded', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    await ingest(store, fake);
    fake.routes.set('/fr/sets', new Status(503));
    const version = store.version();

    const stats = await ingest(store, fake, { kind: 'light' });

    expect(stats.status).toBe('partial');
    expect(stats.skippedRegions).toEqual(['intl']);
    expect(store.listSetIds('intl').sort()).toEqual(['2019sm-fr', 'sv01']);
    expect(store.version()).toBe(version);
  });

  it('records each run', async () => {
    const store = memoryCatalogStore();

    await ingest(store, fakeTcgdex(), { kind: 'full' });

    expect(store.lastCompletedFullRun()).toBeInstanceOf(Date);
  });

  it('stops when aborted and records the run as aborted', async () => {
    const store = memoryCatalogStore();
    const controller = new AbortController();
    const fake = fakeTcgdex();
    const fetchFn = fake.fetch;
    fake.fetch = (...args: Parameters<typeof fetch>) => {
      controller.abort(new Error('stop'));
      return fetchFn(...args);
    };

    await expect(ingest(store, fake, { signal: controller.signal })).rejects.toThrow('stop');

    expect(store.lastCompletedFullRun()).toBeNull();
    expect(store.listSetIds('intl')).toEqual([]);
  });

  it('records a failed run and rethrows unexpected errors', async () => {
    const store = memoryCatalogStore();
    const log = silentLogger();
    vi.spyOn(store, 'replaceSeries').mockImplementation(() => {
      throw new Error('disk full');
    });

    await expect(ingest(store, fakeTcgdex(), { log })).rejects.toThrow('disk full');

    expect(log.errors).toEqual(['catalog.ingest_failed']);
    expect(store.lastCompletedFullRun()).toBeNull();
  });
});
