import type { CatalogLanguage } from '@pokepaper/shared';
import { vi } from 'vitest';
import { runCatalogIngest } from './ingest.js';
import { CARDMARKET_PRICE_GUIDE_URL, parseGuide, runPriceRefresh } from './prices.js';
import type { CatalogStore } from './store.js';
import {
  cardmarketGuide,
  fakeCardmarket,
  fakeClient,
  fakeTcgdex,
  fixtureGuide,
  guideFigures,
  memoryCatalogStore,
  PRODUCTS,
  silentLogger,
  Status,
  type FakeTcgdex,
} from './test-helpers.js';

const LANGUAGES: CatalogLanguage[] = ['en', 'fr', 'ja', 'zh-tw'];
const GUIDE_CREATED = '2026-11-20T01:43:56.000Z';

async function importCatalog(store: CatalogStore, fake: FakeTcgdex = fakeTcgdex()): Promise<void> {
  await runCatalogIngest({
    store,
    client: fakeClient(fake),
    languages: LANGUAGES,
    kind: 'full',
    log: silentLogger(),
  });
}

async function setup() {
  const store = memoryCatalogStore();
  await importCatalog(store);
  const cardmarket = fakeCardmarket();
  const refresh = (overrides: Partial<Parameters<typeof runPriceRefresh>[0]> = {}) =>
    runPriceRefresh({ store, log: silentLogger(), fetch: cardmarket.fetch, ...overrides });
  return { store, cardmarket, refresh };
}

describe('the import', () => {
  it('records each card’s Cardmarket product from its TCGdex details', async () => {
    const store = memoryCatalogStore();
    await importCatalog(store);

    expect(Object.fromEntries(store.listCardmarketProducts('intl'))).toEqual({
      'sv01-001': PRODUCTS.pineco,
      '2019sm-fr-1': PRODUCTS.promo,
    });
    expect(Object.fromEntries(store.listCardmarketProducts('asia'))).toEqual({
      'SV2a-001': PRODUCTS.japanese,
    });
  });

  it('forgets a card’s product once TCGdex no longer reports one', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    await importCatalog(store, fake);
    for (const path of ['/en/cards/sv01-001', '/fr/cards/sv01-001']) {
      const card = fake.routes.get(path) as Record<string, unknown>;
      fake.routes.set(path, { ...card, pricing: { cardmarket: null } });
    }

    await importCatalog(store, fake);

    expect(store.listCardmarketProducts('intl').has('sv01-001')).toBe(false);
  });
});

describe('runPriceRefresh', () => {
  it('downloads Cardmarket’s price guide once and prices every card by its product', async () => {
    const { store, cardmarket, refresh } = await setup();

    const stats = await refresh();

    expect(cardmarket.requests).toBe(1);
    expect(stats).toMatchObject({
      status: 'ok',
      guideCreatedAt: GUIDE_CREATED,
      products: 3,
      cards: { priced: 3, unpriced: 0, unmapped: 1, changed: 3 },
      pruned: 0,
    });
    expect(store.getCardPrices('intl', 'sv01-001')).toEqual({
      updated: GUIDE_CREATED,
      idProduct: PRODUCTS.pineco,
      base: { avg: 0.14, low: 0.02, trend: 0.14, avg1: 0.14, avg7: 0.14, avg30: 0.14 },
      reverseHolo: { avg: 0.28, low: 0.02, trend: 0.28, avg1: 0.28, avg7: 0.28, avg30: 0.28 },
    });
    expect(store.getCardPrices('intl', 'sv01-172')).toBeUndefined();
  });

  it('serves a region’s prices as one pack', async () => {
    const { store, refresh } = await setup();
    await refresh();

    expect(store.getPricePack('asia')).toEqual({
      region: 'asia',
      version: store.pricesVersion('asia'),
      currency: 'EUR',
      prices: {
        'SV2a-001': {
          updated: GUIDE_CREATED,
          idProduct: PRODUCTS.japanese,
          base: { trend: 0.02, avg7: 0.02, avg30: 0.02 },
          reverseHolo: { trend: 8.33, avg7: 8.33, avg30: 8.33 },
        },
      },
    });
    expect(Object.keys(store.getPricePack('intl').prices)).toEqual(['2019sm-fr-1', 'sv01-001']);
  });

  it('leaves out cards whose stored figures include none that clients are sent', async () => {
    const { store, cardmarket, refresh } = await setup();
    cardmarket.current = cardmarketGuide({
      [PRODUCTS.pineco]: { ...guideFigures(0), low: 0.5 },
      [PRODUCTS.promo]: guideFigures(1.5),
      [PRODUCTS.japanese]: guideFigures(0.02),
    });

    await refresh();

    expect(store.getCardPrices('intl', 'sv01-001')?.base?.low).toBe(0.5);
    expect(store.getPricePack('intl').prices['sv01-001']).toBeUndefined();
  });

  it('never changes the catalog itself, so clients don’t download sets again', async () => {
    const { store, refresh } = await setup();
    const version = store.version();
    const hash = store.getSetHash('intl', 'sv01');

    await refresh();

    expect(store.version()).toBe(version);
    expect(store.getSetHash('intl', 'sv01')).toBe(hash);
  });

  it('asks with the last guide’s ETag, changing nothing when it’s unchanged', async () => {
    const { store, cardmarket, refresh } = await setup();
    const first = await refresh({ now: () => new Date('2026-11-21T03:00:00.000Z') });

    const unchanged = await refresh({ now: () => new Date('2026-11-22T03:00:00.000Z') });

    expect(cardmarket.requests).toBe(2);
    expect(unchanged).toMatchObject({ status: 'unchanged', guideCreatedAt: GUIDE_CREATED });
    expect(unchanged.versions).toEqual({});
    expect(store.pricesVersion('intl')).toBe(first.versions.intl);
    // It still counts as a completed pass.
    expect(store.lastCompletedPriceRun()).toEqual(new Date('2026-11-22T03:00:00.000Z'));
  });

  it('bumps a region’s prices version only when its prices change', async () => {
    const { store, cardmarket, refresh } = await setup();
    const first = await refresh();
    cardmarket.current = cardmarketGuide(
      {
        [PRODUCTS.pineco]: guideFigures(0.2, 0.28),
        [PRODUCTS.promo]: guideFigures(1.5),
        [PRODUCTS.japanese]: guideFigures(0.02, 8.33),
      },
      GUIDE_CREATED
    );

    const changed = await refresh();

    expect(changed.cards.changed).toBe(1);
    expect(changed.versions.intl).toBeGreaterThan(first.versions.intl ?? 0);
    expect(changed.versions.asia).toBe(first.versions.asia);
    expect(store.getCardPrices('intl', 'sv01-001')?.base?.trend).toBe(0.2);
  });

  it('removes a card’s prices once its product leaves the guide', async () => {
    const { store, cardmarket, refresh } = await setup();
    await refresh();
    cardmarket.current = cardmarketGuide({
      [PRODUCTS.pineco]: guideFigures(0.14, 0.28),
      [PRODUCTS.japanese]: guideFigures(0.02, 8.33),
    });

    const stats = await refresh();

    expect(stats.cards).toMatchObject({ priced: 2, unpriced: 1, changed: 1 });
    expect(store.getCardPrices('intl', '2019sm-fr-1')).toBeUndefined();
  });

  it.each([
    ['Cardmarket is unreachable', 'offline'],
    ['Cardmarket answers with an error', new Status(503)],
    ['the download isn’t JSON', '<html>maintenance</html>'],
    ['the download isn’t a price guide', { version: 1, products: [] }],
  ])('keeps every price when %s, and tries again next run', async (_label, guide) => {
    const { store, cardmarket, refresh } = await setup();
    await refresh({ now: () => new Date('2026-11-21T03:00:00.000Z') });
    const before = store.getPricePack('intl');
    cardmarket.current = guide;
    const log = silentLogger();
    if (guide === 'offline') {
      cardmarket.fetch = () => Promise.reject(new Error('offline'));
    }

    const stats = await refresh({ log, now: () => new Date('2026-11-22T03:00:00.000Z') });

    expect(stats.status).toBe('failed');
    expect(log.warnings).toEqual(['catalog.price_guide_failed', 'catalog.prices_finished']);
    expect(store.getPricePack('intl')).toEqual(before);
    expect(store.lastCompletedPriceRun()).toEqual(new Date('2026-11-21T03:00:00.000Z'));
  });

  it('refuses a guide missing most of the catalog’s products', async () => {
    const { store, cardmarket, refresh } = await setup();
    // Enough cards with products for the share to count.
    const pack = store.getSetPack('intl', 'sv01');
    const template = pack?.cards[0];
    if (!pack || !template) {
      throw new Error('fixture set missing');
    }
    const cards = Array.from({ length: 120 }, (_, index) => ({
      ...template,
      id: `big-${String(index)}`,
      setId: 'big',
      sortIndex: index,
    }));
    store.writeSet({ ...pack.set, id: 'big' }, cards);
    store.saveCardmarketProducts(
      'intl',
      new Map(cards.map((card, index) => [card.id, 900000 + index]))
    );
    await refresh();
    const before = store.getPricePack('intl');
    const log = silentLogger();
    cardmarket.current = fixtureGuide('2026-11-21T02:43:56+0100'); // Only the 3 fixture products.

    const stats = await refresh({ log });

    expect(stats.status).toBe('failed');
    expect(log.warnings).toContain('catalog.price_guide_incomplete');
    expect(store.getPricePack('intl')).toEqual(before);
  });

  it('prunes prices and products of cards that left the catalog', async () => {
    const { store, refresh } = await setup();
    const first = await refresh();
    const fake = fakeTcgdex();
    fake.routes.set('/fr/sets', [{ id: 'sv01' }]);
    await importCatalog(store, fake);
    const cardmarket = fakeCardmarket(fixtureGuide('2026-11-21T02:43:56+0100'));

    const stats = await runPriceRefresh({ store, log: silentLogger(), fetch: cardmarket.fetch });

    expect(stats.pruned).toBe(1);
    expect(stats.versions.intl).toBeGreaterThan(first.versions.intl ?? 0);
    expect(store.getCardPrices('intl', '2019sm-fr-1')).toBeUndefined();
    expect(store.listCardmarketProducts('intl').has('2019sm-fr-1')).toBe(false);
  });

  it('records each pass with the time it started', async () => {
    const { store, refresh } = await setup();
    const started = new Date('2026-11-21T03:00:00.000Z');

    await refresh({ now: () => started });

    expect(store.lastCompletedPriceRun()).toEqual(started);
    expect(store.listPriceRuns(1)[0]?.status).toBe('ok');
  });

  it('stops when aborted and records the pass as aborted', async () => {
    const { store, refresh } = await setup();
    const controller = new AbortController();

    await expect(
      refresh({
        signal: controller.signal,
        fetch: () => {
          controller.abort(new Error('stop'));
          return Promise.reject(new Error('stop'));
        },
      })
    ).rejects.toThrow('stop');

    expect(store.listPriceRuns(1)[0]?.status).toBe('aborted');
    expect(store.lastCompletedPriceRun()).toBeNull();
  });

  it('records a failed pass and rethrows database errors, even if recording fails too', async () => {
    const { store, refresh } = await setup();
    const log = silentLogger();
    vi.spyOn(store, 'writeCardPrices').mockImplementation(() => {
      throw new Error('disk full');
    });

    await expect(refresh({ log })).rejects.toThrow('disk full');
    expect(store.listPriceRuns(1)[0]?.status).toBe('failed');
    expect(log.errors).toEqual(['catalog.prices_failed']);

    vi.spyOn(store, 'finishPriceRun').mockImplementation(() => {
      throw new Error('still full');
    });
    await expect(refresh({ log })).rejects.toThrow('disk full');
    expect(log.errors).toEqual([
      'catalog.prices_failed',
      'catalog.prices_failed',
      'catalog.run_record_failed',
    ]);
  });

  it('fetches Cardmarket’s Pokémon price guide', async () => {
    const { refresh } = await setup();
    const fetch = vi.fn(fakeCardmarket().fetch);

    await refresh({ fetch });

    expect(fetch).toHaveBeenCalledWith(CARDMARKET_PRICE_GUIDE_URL, expect.anything());
  });
});

describe('parseGuide', () => {
  it('reads the generation time and entries by product', () => {
    const guide = parseGuide(fixtureGuide());

    expect(guide?.createdAt).toBe(GUIDE_CREATED);
    expect([...(guide?.entries.keys() ?? [])].sort()).toEqual(
      [PRODUCTS.pineco, PRODUCTS.promo, PRODUCTS.japanese].sort()
    );
  });

  it.each([
    ['not an object', []],
    ['no entries', { createdAt: '2026-11-20T02:43:56+0100', priceGuides: [] }],
    ['no generation time', { priceGuides: [{ idProduct: 1 }] }],
    ['entries without products', { createdAt: '2026-11-20', priceGuides: [{ trend: 1 }] }],
  ])('is null for %s', (_label, value) => {
    expect(parseGuide(value)).toBeNull();
  });
});
