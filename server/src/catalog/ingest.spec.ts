import type { CatalogLanguage } from '@pokepaper/shared';
import { runCatalogIngest, type CatalogIngestOptions } from './ingest.js';
import type { CatalogStore } from './store.js';
import { TcgdexClient } from './tcgdex-client.js';
import {
  Bytes,
  fakeClient,
  fakeTcgdex,
  memoryCatalogStore,
  silentLogger,
  Status,
  webp,
  type FakeTcgdex,
} from './test-helpers.js';

const LANGUAGES: CatalogLanguage[] = ['en', 'fr', 'ja', 'zh-tw'];

/** Puts both sizes of a scan on the fake asset host. */
function hostScan(fake: FakeTcgdex, path: string): void {
  fake.routes.set(`asset:${path}/low.webp`, new Bytes(webp()));
  fake.routes.set(`asset:${path}/high.webp`, new Bytes(webp()));
}

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

  it.each([
    ['answers with something that is not a set', '<html>Bad gateway</html>'],
    ['is refused', new Status(403)],
    ['is missing', new Status(404)],
  ])('keeps a set and all its languages when one language’s detail %s', async (_case, route) => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    await ingest(store, fake);
    const before = store.listSetCards('intl', 'sv01');
    const version = store.version();
    fake.routes.set('/fr/sets/sv01', route);

    const stats = await ingest(store, fake, { kind: 'light' });

    expect(stats.sets).toMatchObject({ failed: 1, removed: 0 });
    expect(store.listSetCards('intl', 'sv01')).toEqual(before);
    expect(store.getSet('intl', 'sv01')?.set.languages).toEqual(['en', 'fr']);
    expect(store.version()).toBe(version);
  });

  it('keeps a set whose details are unusable in every language', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    await ingest(store, fake);
    for (const language of ['en', 'fr']) {
      const detail = fake.routes.get(`/${language}/sets/sv01`) as { serie?: unknown };
      delete detail.serie;
    }

    const stats = await ingest(store, fake, { kind: 'light' });

    expect(stats.sets).toMatchObject({ failed: 1, removed: 0 });
    expect(store.listSetCards('intl', 'sv01')).toHaveLength(2);
  });

  it('cancels a set’s remaining card requests once TCGdex is unavailable', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    for (const path of [...fake.routes.keys()].filter((key) => key.includes('/cards/sv01-'))) {
      fake.routes.set(path, new Status(503));
    }
    const client = new TcgdexClient({
      fetch: fake.fetch,
      sleep: () => Promise.resolve(),
      concurrency: 1,
    });

    const stats = await ingest(store, fake, { client, languages: ['en', 'fr'] });

    expect(stats.sets.failed).toBe(1);
    // One card's four attempts, plus at most one request that took the freed
    // slot just before the cancel landed. Without cancelling: 4 cards × 4.
    expect(fake.calls.filter((path) => path.includes('/cards/sv01-')).length).toBeLessThanOrEqual(
      5
    );
  });

  it('skips the rest of a region after several sets in a row fail, keeping their data', async () => {
    const store = memoryCatalogStore();
    const ids = ['s1', 's2', 's3', 's4', 's5'];
    const routes: Record<string, unknown> = {
      '/en/series': [{ id: 'x', name: 'X' }],
      '/en/sets': ids.map((id) => ({ id })),
    };
    for (const id of ids) {
      routes[`/en/sets/${id}`] = {
        id,
        name: id,
        serie: { id: 'x' },
        cards: [{ id: `${id}-1`, localId: '1' }],
      };
      routes[`/en/cards/${id}-1`] = { id: `${id}-1`, localId: '1', name: id, category: 'Pokemon' };
    }
    const fake = fakeTcgdex(routes);
    await ingest(store, fake, { languages: ['en'] });
    for (const id of ids) {
      fake.routes.set(`/en/sets/${id}`, new Status(503));
    }
    fake.calls.length = 0;
    const log = silentLogger();

    const stats = await ingest(store, fake, { languages: ['en'], log });

    expect(stats).toMatchObject({
      status: 'partial',
      sets: { failed: 3, skipped: 2, removed: 0 },
    });
    expect(fake.calls).not.toContain('/en/sets/s4');
    expect(store.listSetIds('intl').sort()).toEqual(ids);
    expect(log.warnings).toContain('catalog.region_interrupted');
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

  it('finds scans TCGdex has but does not link, and remembers the answer', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    // sv01-172 has no French printing, so nothing is checked for it even
    // though the asset exists. 2019sm-fr-1 links no scan in any language, so
    // its path is built from serie/set/number.
    hostScan(fake, 'fr/sv/sv01/172');
    hostScan(fake, 'fr/misc/2019sm-fr/1');

    const stats = await ingest(store, fake);

    expect(card(store, 'intl', 'sv01', 'sv01-172')?.text.fr).toBeUndefined();
    expect(card(store, 'intl', '2019sm-fr', '2019sm-fr-1')?.text.fr?.image).toBe(
      'fr/misc/2019sm-fr/1'
    );
    expect(stats.images).toEqual({ probed: 1, found: 1, failed: 0, borrowed: 0 });
    expect(store.getImageProbe('fr/misc/2019sm-fr/1')?.found).toBe(true);

    fake.calls.length = 0;
    await ingest(store, fake, { kind: 'full' });
    expect(fake.calls.filter((path) => path.startsWith('asset:'))).toEqual([]);
    expect(card(store, 'intl', '2019sm-fr', '2019sm-fr-1')?.text.fr?.image).toBe(
      'fr/misc/2019sm-fr/1'
    );
  });

  it('swaps the language into another language’s linked path when checking', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    // A French printing exists for sv01-172, without a linked scan.
    fake.routes.set('/fr/cards/sv01-172', {
      id: 'sv01-172',
      localId: '172',
      name: 'Recherche d’Énergie',
      category: 'Dresseur',
    });
    hostScan(fake, 'fr/sv/sv01/172');

    await ingest(store, fake);

    expect(card(store, 'intl', 'sv01', 'sv01-172')?.text.fr?.image).toBe('fr/sv/sv01/172');
  });

  it('re-checks a missing scan only after the miss expires, and retries failed checks', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    fake.routes.set('asset:fr/misc/2019sm-fr/1/low.webp', new Status(503));

    const failed = await ingest(store, fake);
    expect(failed.images).toMatchObject({ probed: 0, failed: 1 });
    expect(failed.status).toBe('partial');
    expect(store.getImageProbe('fr/misc/2019sm-fr/1')).toBeUndefined();

    fake.routes.delete('asset:fr/misc/2019sm-fr/1/low.webp');
    await ingest(store, fake);
    expect(store.getImageProbe('fr/misc/2019sm-fr/1')?.found).toBe(false);

    fake.calls.length = 0;
    await ingest(store, fake);
    expect(fake.calls.filter((path) => path.startsWith('asset:'))).toEqual([]);

    store.saveImageProbe(
      'fr/misc/2019sm-fr/1',
      false,
      new Date(Date.now() - 31 * 24 * 3600 * 1000)
    );
    hostScan(fake, 'fr/misc/2019sm-fr/1');
    await ingest(store, fake);
    expect(card(store, 'intl', '2019sm-fr', '2019sm-fr-1')?.text.fr?.image).toBe(
      'fr/misc/2019sm-fr/1'
    );
  });

  describe('basic Energy scans', () => {
    const ASSETS = 'https://assets.tcgdex.net';
    /** Adds an English Energy set (one Fire Energy, scanned or not) to the fake. */
    function energySet(
      fake: FakeTcgdex,
      setId: string,
      serie: string,
      date: string,
      scanned: boolean
    ) {
      const cardId = `${setId}-2`;
      const image = scanned ? { image: `${ASSETS}/en/${serie}/${setId}/2` } : {};
      fake.routes.set(`/en/sets/${setId}`, {
        id: setId,
        name: setId,
        serie: { id: serie, name: serie },
        releaseDate: date,
        cardCount: { total: 1, official: 1 },
        cards: [{ id: cardId, localId: '2', name: 'Fire Energy', ...image }],
      });
      fake.routes.set(`/en/cards/${cardId}`, {
        id: cardId,
        localId: '2',
        name: 'Fire Energy',
        category: 'Energy',
        energyType: 'Normal',
        ...image,
      });
    }

    it('borrows the newest scan of the type, until the card has its own', async () => {
      const store = memoryCatalogStore();
      const fake = fakeTcgdex();
      fake.routes.set('/en/series', [
        { id: 'sv', name: 'Scarlet & Violet' },
        { id: 'me', name: 'Mega Evolution' },
      ]);
      fake.routes.set('/en/sets', [{ id: 'sv01' }, { id: 'mee' }, { id: 'sve' }]);
      energySet(fake, 'sve', 'sv', '2023-03-31', true);
      energySet(fake, 'mee', 'me', '2025-09-26', false);

      const first = await ingest(store, fake);

      expect(card(store, 'intl', 'mee', 'mee-2')?.text.en).toMatchObject({
        image: 'en/sv/sve/2',
        imageFrom: 'sve-2',
      });
      expect(card(store, 'intl', 'sve', 'sve-2')?.text.en).not.toHaveProperty('imageFrom');
      expect(first.images.borrowed).toBe(1);
      // The card's own path was checked first (and missed).
      expect(store.getImageProbe('en/me/mee/2')?.found).toBe(false);

      // Unchanged on the next runs, full ones included: a set rebuilt from
      // fresh data keeps its borrowed scans, so it isn't rewritten.
      const hash = store.getSetHash('intl', 'mee');
      const second = await ingest(store, fake, { kind: 'light' });
      expect(second.images.borrowed).toBe(0);
      const full = await ingest(store, fake, { kind: 'full' });
      expect(full.images.borrowed).toBe(0);
      expect(store.getSetHash('intl', 'mee')).toBe(hash);
      expect(card(store, 'intl', 'mee', 'mee-2')?.text.en?.imageFrom).toBe('sve-2');

      // TCGdex gets the card's own scan: it replaces the borrowed one.
      store.saveImageProbe('en/me/mee/2', false, new Date(Date.now() - 31 * 24 * 3600 * 1000));
      hostScan(fake, 'en/me/mee/2');
      await ingest(store, fake, { kind: 'light' });
      const own = card(store, 'intl', 'mee', 'mee-2')?.text.en;
      expect(own?.image).toBe('en/me/mee/2');
      expect(own).not.toHaveProperty('imageFrom');
    });

    it('drops a borrowed scan once its source is gone', async () => {
      const store = memoryCatalogStore();
      const fake = fakeTcgdex();
      fake.routes.set('/en/series', [
        { id: 'sv', name: 'Scarlet & Violet' },
        { id: 'me', name: 'Mega Evolution' },
      ]);
      fake.routes.set('/en/sets', [{ id: 'sv01' }, { id: 'mee' }, { id: 'sve' }]);
      energySet(fake, 'sve', 'sv', '2023-03-31', true);
      energySet(fake, 'mee', 'me', '2025-09-26', false);
      await ingest(store, fake);

      fake.routes.set('/en/sets', [{ id: 'sv01' }, { id: 'mee' }]);
      // A light run keeps the stored card, borrowed scan and all (a full run
      // refetches it without one).
      const after = await ingest(store, fake, { kind: 'light' });

      expect(card(store, 'intl', 'mee', 'mee-2')?.text.en?.image).toBeNull();
      expect(after.images.borrowed).toBe(1);
    });
  });

  it('links an unlinked scan only when both sizes exist', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    fake.routes.set('asset:fr/misc/2019sm-fr/1/low.webp', new Bytes(webp()));

    await ingest(store, fake);

    expect(card(store, 'intl', '2019sm-fr', '2019sm-fr-1')?.text.fr?.image).toBeNull();
    expect(store.getImageProbe('fr/misc/2019sm-fr/1')?.found).toBe(false);
  });

  it('never checks paths built from unsafe TCGdex IDs', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    const detail = fake.routes.get('/fr/sets/2019sm-fr') as { cards: { localId: string }[] };
    const promo = fake.routes.get('/fr/cards/2019sm-fr-1') as { localId: string };
    for (const target of [...detail.cards, promo]) {
      target.localId = '..';
    }

    await ingest(store, fake);

    expect(fake.calls.filter((path) => path.startsWith('asset:'))).toEqual([]);
  });

  it('cancels a set’s remaining image checks on failure, and pauses checking after 3 such sets', async () => {
    const store = memoryCatalogStore();
    const ids = ['s1', 's2', 's3', 's4'];
    const routes: Record<string, unknown> = {
      '/en/series': [{ id: 'x', name: 'X' }],
      '/en/sets': ids.map((id) => ({ id })),
    };
    for (const id of ids) {
      routes[`/en/sets/${id}`] = {
        id,
        name: id,
        serie: { id: 'x' },
        cards: [1, 2, 3].map((n) => ({ id: `${id}-${String(n)}`, localId: String(n) })),
      };
      for (const n of [1, 2, 3]) {
        routes[`/en/cards/${id}-${String(n)}`] = {
          id: `${id}-${String(n)}`,
          localId: String(n),
          name: id,
          category: 'Pokemon',
        };
        routes[`asset:en/x/${id}/${String(n)}/low.webp`] = new Status(503);
      }
    }
    const fake = fakeTcgdex(routes);
    const client = new TcgdexClient({
      fetch: fake.fetch,
      sleep: () => Promise.resolve(),
      concurrency: 1,
    });
    const log = silentLogger();

    const stats = await ingest(store, fake, { client, languages: ['en'], log });

    const checked = (id: string) =>
      fake.calls.filter((path) => path.startsWith(`asset:en/x/${id}/`));
    // One check's four attempts per set; its siblings are cancelled (at most
    // one slips into the freed slot first).
    expect(checked('s1').length).toBeLessThanOrEqual(5);
    expect(checked('s4')).toEqual([]);
    expect(stats.images.failed).toBe(9);
    expect(stats.sets.written).toBe(4);
    expect(stats.status).toBe('partial');
    expect(log.warnings).toEqual([
      'catalog.image_checks_failed',
      'catalog.image_checks_failed',
      'catalog.image_checks_failed',
      'catalog.image_checks_paused',
    ]);
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

  it('rethrows the original error even when recording the run fails too', async () => {
    const store = memoryCatalogStore();
    const log = silentLogger();
    vi.spyOn(store, 'replaceSeries').mockImplementation(() => {
      throw new Error('disk full');
    });
    vi.spyOn(store, 'finishRun').mockImplementation(() => {
      throw new Error('still full');
    });

    await expect(ingest(store, fakeTcgdex(), { log })).rejects.toThrow('disk full');

    expect(log.errors).toEqual(['catalog.ingest_failed', 'catalog.run_record_failed']);
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
