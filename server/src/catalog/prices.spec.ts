import type { CatalogLanguage } from '@pokepaper/shared';
import { runCatalogIngest } from './ingest.js';
import { runPriceRefresh, type PriceRefreshOptions } from './prices.js';
import type { CatalogStore } from './store.js';
import { TcgdexClient } from './tcgdex-client.js';
import {
  fakeClient,
  fakeTcgdex,
  memoryCatalogStore,
  silentLogger,
  Status,
  tcgdexPricing,
  type FakeTcgdex,
} from './test-helpers.js';

const LANGUAGES: CatalogLanguage[] = ['en', 'fr', 'ja', 'zh-tw'];

async function importCatalog(
  store: CatalogStore,
  fake: FakeTcgdex,
  languages: CatalogLanguage[] = LANGUAGES
): Promise<void> {
  await runCatalogIngest({
    store,
    client: fakeClient(fake),
    languages,
    kind: 'full',
    log: silentLogger(),
  });
  fake.calls.length = 0;
}

function refresh(
  store: CatalogStore,
  fake: FakeTcgdex,
  overrides: Partial<PriceRefreshOptions> = {}
) {
  return runPriceRefresh({
    store,
    client: fakeClient(fake, overrides.signal),
    languages: LANGUAGES,
    log: silentLogger(),
    ...overrides,
  });
}

/** Sets the pricing a fake TCGdex card reports. */
function setPricing(fake: FakeTcgdex, path: string, pricing: unknown): void {
  const card = fake.routes.get(path) as Record<string, unknown>;
  fake.routes.set(path, { ...card, pricing });
}

describe('runPriceRefresh', () => {
  it('fetches each card once, in the first language it has, and stores its prices', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    await importCatalog(store, fake);

    const stats = await refresh(store, fake);

    // English first, French for the French-only promo, Japanese before Chinese.
    expect([...fake.calls].sort()).toEqual([
      '/en/cards/sv01-001',
      '/en/cards/sv01-172',
      '/fr/cards/2019sm-fr-1',
      '/ja/cards/SV2a-001',
    ]);
    expect(stats).toMatchObject({
      status: 'ok',
      sets: { seen: 3, failed: 0, skipped: 0 },
      cards: { priced: 3, unpriced: 1, skipped: 0, changed: 3 },
      pruned: 0,
      requests: 4,
    });
    expect(stats.versions.intl).toBeGreaterThan(0);
    expect(stats.versions.asia).toBeGreaterThan(0);
    expect(store.getCardPrices('intl', 'sv01-001')).toEqual({
      updated: '2026-11-20T22:24:05.881Z',
      idProduct: 483559,
      base: { avg: 0.14, low: 0.02, trend: 0.14, avg1: 0.14, avg7: 0.14, avg30: 0.14 },
      reverseHolo: { avg: 0.28, low: 0.02, trend: 0.28, avg1: 0.28, avg7: 0.28, avg30: 0.28 },
    });
    expect(store.getCardPrices('intl', 'sv01-172')).toBeUndefined();
  });

  it('serves a region’s prices as one pack', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    await importCatalog(store, fake);
    await refresh(store, fake);

    expect(store.getPricePack('asia')).toEqual({
      region: 'asia',
      version: store.pricesVersion('asia'),
      currency: 'EUR',
      prices: {
        'SV2a-001': {
          updated: '2026-11-20T22:24:05.881Z',
          idProduct: 483559,
          base: { trend: 0.02, avg7: 0.02, avg30: 0.02 },
          reverseHolo: { trend: 8.33, avg7: 8.33, avg30: 8.33 },
        },
      },
    });
    expect(Object.keys(store.getPricePack('intl').prices)).toEqual(['2019sm-fr-1', 'sv01-001']);
  });

  it('leaves out cards whose stored figures include none that clients are sent', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    await importCatalog(store, fake);
    setPricing(fake, '/en/cards/sv01-172', {
      cardmarket: { updated: '2026-11-21T00:00:00Z', unit: 'EUR', low: 0.5, trend: 0 },
    });

    await refresh(store, fake);

    expect(store.getCardPrices('intl', 'sv01-172')?.base?.low).toBe(0.5);
    expect(store.getPricePack('intl').prices['sv01-172']).toBeUndefined();
  });

  it('never changes the catalog itself, so clients don’t download sets again', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    await importCatalog(store, fake);
    const version = store.version();
    const hash = store.getSetHash('intl', 'sv01');

    await refresh(store, fake);

    expect(store.version()).toBe(version);
    expect(store.getSetHash('intl', 'sv01')).toBe(hash);
  });

  it('bumps a region’s prices version only when its prices change', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    await importCatalog(store, fake);
    const first = await refresh(store, fake);

    const unchanged = await refresh(store, fake);
    expect(unchanged.cards.changed).toBe(0);
    expect(unchanged.versions).toEqual(first.versions);

    setPricing(fake, '/en/cards/sv01-001', tcgdexPricing(0.2, 0.28, '2026-11-21T22:24:05.881Z'));
    const changed = await refresh(store, fake);
    expect(changed.cards.changed).toBe(1);
    expect(changed.versions.intl).toBeGreaterThan(first.versions.intl ?? 0);
    expect(changed.versions.asia).toBe(first.versions.asia);
    expect(store.getCardPrices('intl', 'sv01-001')?.base?.trend).toBe(0.2);
  });

  it('removes a card’s prices once Cardmarket no longer reports any', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    await importCatalog(store, fake);
    const first = await refresh(store, fake);
    setPricing(fake, '/en/cards/sv01-001', { cardmarket: null, tcgplayer: null });

    const stats = await refresh(store, fake);

    expect(stats.cards).toMatchObject({ unpriced: 2, changed: 1 });
    expect(store.getCardPrices('intl', 'sv01-001')).toBeUndefined();
    expect(stats.versions.intl).toBeGreaterThan(first.versions.intl ?? 0);
  });

  it.each([
    ['is missing', new Status(404)],
    ['is malformed', '<html>oops</html>'],
    ['is another card', { id: 'sv01-999', pricing: tcgdexPricing(99) }],
  ])('keeps a card’s prices when its detail %s', async (_case, route) => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    await importCatalog(store, fake);
    await refresh(store, fake);
    const before = store.getCardPrices('intl', 'sv01-001');
    fake.routes.set('/en/cards/sv01-001', route);

    const stats = await refresh(store, fake);

    expect(stats.status).toBe('ok');
    expect(stats.cards.skipped).toBe(1);
    expect(store.getCardPrices('intl', 'sv01-001')).toEqual(before);
  });

  it('keeps the prices of a card TCGdex stays unavailable for, refreshing the rest of its set', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    await importCatalog(store, fake);
    await refresh(store, fake);
    const before = store.getCardPrices('intl', 'sv01-001');
    fake.routes.set('/en/cards/sv01-001', new Status(503));
    setPricing(fake, '/en/cards/sv01-172', tcgdexPricing(5));
    const log = silentLogger();

    const stats = await refresh(store, fake, { log });

    expect(stats).toMatchObject({
      status: 'partial',
      sets: { seen: 3, refreshed: 3, failed: 0 },
      cards: { priced: 3, unavailable: 1 },
    });
    expect(store.getCardPrices('intl', 'sv01-001')).toEqual(before);
    expect(store.getCardPrices('intl', 'sv01-172')?.base?.trend).toBe(5);
    expect(log.warnings).toEqual(['catalog.prices_cards_unavailable']);
  });

  it('keeps a set’s prices when TCGdex is unavailable for all of its cards', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    await importCatalog(store, fake);
    await refresh(store, fake);
    const before = store.getCardPrices('intl', 'sv01-001');
    fake.routes.set('/en/cards/sv01-001', new Status(503));
    fake.routes.set('/en/cards/sv01-172', new Status(503));
    const log = silentLogger();

    const stats = await refresh(store, fake, { log });

    expect(stats).toMatchObject({
      status: 'partial',
      sets: { seen: 3, refreshed: 2, failed: 1 },
      // Only the refreshed sets' cards count.
      cards: { priced: 2, unpriced: 0, unavailable: 0 },
    });
    expect(store.getCardPrices('intl', 'sv01-001')).toEqual(before);
    expect(log.warnings).toEqual(['catalog.prices_set_failed']);
  });

  it('fails a set once TCGdex is unavailable for 3 of its cards, cancelling the rest', async () => {
    const store = memoryCatalogStore();
    const cards = ['1', '2', '3', '4', '5', '6'];
    const routes: Record<string, unknown> = {
      '/en/series': [{ id: 'x', name: 'X' }],
      '/en/sets': [{ id: 'big' }],
      '/en/sets/big': {
        id: 'big',
        name: 'Big',
        serie: { id: 'x' },
        cards: cards.map((localId) => ({ id: `big-${localId}`, localId })),
      },
    };
    for (const localId of cards) {
      routes[`/en/cards/big-${localId}`] = {
        id: `big-${localId}`,
        localId,
        name: localId,
        category: 'Pokemon',
        pricing: tcgdexPricing(1),
      };
    }
    const fake = fakeTcgdex(routes);
    await importCatalog(store, fake, ['en']);
    for (const localId of cards) {
      fake.routes.set(`/en/cards/big-${localId}`, new Status(503));
    }
    fake.routes.set('/en/cards/big-6', { ...(routes['/en/cards/big-6'] as object) });
    const client = new TcgdexClient({
      fetch: fake.fetch,
      sleep: () => Promise.resolve(),
      concurrency: 1,
    });

    const stats = await refresh(store, fake, { client, languages: ['en'] });

    expect(stats).toMatchObject({ status: 'failed', sets: { failed: 1, refreshed: 0 } });
    expect(store.getCardPrices('intl', 'big-6')).toBeUndefined();
    // Three cards' four attempts, plus at most one request that took the
    // freed slot just before the cancel landed.
    expect(fake.calls.length).toBeLessThanOrEqual(13);
  });

  it('skips the rest of a region after several sets in a row fail', async () => {
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
    await importCatalog(store, fake, ['en']);
    for (const id of ids) {
      fake.routes.set(`/en/cards/${id}-1`, new Status(503));
    }
    const log = silentLogger();

    const stats = await refresh(store, fake, { languages: ['en'], log });

    expect(stats).toMatchObject({
      status: 'failed',
      sets: { seen: 5, refreshed: 0, failed: 3, skipped: 2 },
    });
    // Four attempts for each of the three failed sets, none for the rest.
    expect(fake.calls).toHaveLength(12);
    expect(log.warnings).toContain('catalog.prices_region_interrupted');
    // Nothing was refreshed, so the next scheduled run tries again.
    expect(store.listPriceRuns(1)[0]?.status).toBe('failed');
    expect(store.lastCompletedPriceRun()).toBeNull();
  });

  it('skips cards without an imported language', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    await importCatalog(store, fake);

    // The French-only promo has no English text.
    const stats = await refresh(store, fake, { languages: ['en'] });

    expect(stats.cards).toMatchObject({ priced: 1, unpriced: 1, skipped: 1 });
    expect(fake.calls).not.toContain('/fr/cards/2019sm-fr-1');
  });

  it('prunes prices of cards that left the catalog', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    await importCatalog(store, fake);
    const first = await refresh(store, fake);
    fake.routes.set('/fr/sets', [{ id: 'sv01' }]);
    await importCatalog(store, fake);

    const stats = await refresh(store, fake);

    expect(stats.pruned).toBe(1);
    expect(stats.versions.intl).toBeGreaterThan(first.versions.intl ?? 0);
    expect(store.getCardPrices('intl', '2019sm-fr-1')).toBeUndefined();
  });

  it('records each pass with the time it started', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    await importCatalog(store, fake);
    const started = new Date('2026-11-21T03:00:00.000Z');

    await refresh(store, fake, { now: () => started });

    expect(store.lastCompletedPriceRun()).toEqual(started);
    expect(store.listPriceRuns(1)[0]?.status).toBe('ok');
  });

  it('stops when aborted and records the pass as aborted', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    await importCatalog(store, fake);
    const controller = new AbortController();
    const fetchFn = fake.fetch;
    fake.fetch = (...args: Parameters<typeof fetch>) => {
      controller.abort(new Error('stop'));
      return fetchFn(...args);
    };

    await expect(refresh(store, fake, { signal: controller.signal })).rejects.toThrow('stop');

    expect(store.listPriceRuns(1)[0]?.status).toBe('aborted');
    expect(store.lastCompletedPriceRun()).toBeNull();
  });

  it('records a failed pass and rethrows database errors, even if recording fails too', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    await importCatalog(store, fake);
    const log = silentLogger();
    vi.spyOn(store, 'writeCardPrices').mockImplementation(() => {
      throw new Error('disk full');
    });

    await expect(refresh(store, fake, { log })).rejects.toThrow('disk full');
    expect(store.listPriceRuns(1)[0]?.status).toBe('failed');
    expect(log.errors).toEqual(['catalog.prices_failed']);

    vi.spyOn(store, 'finishPriceRun').mockImplementation(() => {
      throw new Error('still full');
    });
    await expect(refresh(store, fake, { log })).rejects.toThrow('disk full');
    expect(log.errors).toEqual([
      'catalog.prices_failed',
      'catalog.prices_failed',
      'catalog.run_record_failed',
    ]);
  });
});
