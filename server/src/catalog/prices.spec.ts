import type { CatalogLanguage } from '@pokepaper/shared';
import { vi } from 'vitest';
import { runCatalogIngest } from './ingest.js';
import { parseGuideEntry } from './price-data.js';
import { readCapped } from './download.js';
import { parseProductList } from './cardmarket-products.js';
import {
  CARDMARKET_PRICE_GUIDE_URL,
  parseGuide,
  repriceCard,
  runPriceRefresh,
  type CardmarketMatchSource,
} from './prices.js';
import type { CatalogStore } from './store.js';
import {
  cardmarketGuide,
  cardmarketProductList,
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

async function importCatalog(
  store: CatalogStore,
  fake: FakeTcgdex = fakeTcgdex(),
  languages: CatalogLanguage[] = LANGUAGES,
  kind: 'full' | 'light' = 'full'
): Promise<void> {
  await runCatalogIngest({ store, client: fakeClient(fake), languages, kind, log: silentLogger() });
}

/** Makes TCGdex report no Cardmarket data for these card details. */
function withoutPricing(fake: FakeTcgdex, ...paths: string[]): void {
  for (const path of paths) {
    const card = fake.routes.get(path) as Record<string, unknown>;
    fake.routes.set(path, { ...card, pricing: { cardmarket: null } });
  }
}

/** Stores Cardmarket's product list, naming each product as given. */
function storeProductList(
  store: CatalogStore,
  names: Record<number, string>,
  createdAt = '2026-11-24T13:07:30+0100'
): void {
  const list = parseProductList(
    cardmarketProductList(
      Object.entries(names).map(([idProduct, name]) => ({
        idProduct: Number(idProduct),
        name,
        idExpansion: 5001,
      })),
      createdAt
    )
  );
  if (!list) {
    throw new Error('no product list');
  }
  store.replaceCardmarketProducts(list.products, {
    etag: null,
    createdAt: list.createdAt,
    checkedAt: list.createdAt,
  });
}

/** Matches made by hand, as `CardmarketMatchStore` serves them. */
function handMatches(region: 'intl', entries: Record<string, number>): CardmarketMatchSource {
  const map = new Map(Object.entries(entries));
  return {
    get: (other, cardId) => (other === region ? map.get(cardId) : undefined),
    list: (other) => (other === region ? new Map(map) : new Map()),
    version: () => 1,
  };
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

  it('forgets a card’s product, and its prices, once a full run finds none', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    await importCatalog(store, fake);
    await runPriceRefresh({ store, log: silentLogger(), fetch: fakeCardmarket().fetch });
    const version = store.pricesVersion('intl');
    withoutPricing(fake, '/en/cards/sv01-001', '/fr/cards/sv01-001');

    await importCatalog(store, fake);

    expect(store.listCardmarketProducts('intl').has('sv01-001')).toBe(false);
    expect(store.getCardPrices('intl', 'sv01-001')).toBeUndefined();
    expect(store.pricesVersion('intl')).toBeGreaterThan(version);
  });

  it('never forgets a product in a light run, which fetches only new languages', async () => {
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    await importCatalog(store, fake, ['en', 'ja']);
    withoutPricing(fake, '/fr/cards/sv01-001');

    await importCatalog(store, fake, LANGUAGES, 'light');

    expect(store.listCardmarketProducts('intl').get('sv01-001')).toBe(PRODUCTS.pineco);
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

  it('keeps the guide’s entries for the matcher', async () => {
    const { store, refresh } = await setup();

    await refresh();

    expect(store.getPriceGuideEntries([PRODUCTS.promo, 999]).get(PRODUCTS.promo)).toMatchObject({
      idProduct: PRODUCTS.promo,
      trend: 1.5,
    });
    expect(store.getPriceGuideEntries([999]).size).toBe(0);
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

  it('leaves a card without a product as it was', async () => {
    const { store, refresh } = await setup();
    await refresh();
    // Prices from before it had no product (sv01-172 has none).
    const earlier = parseGuideEntry({ idProduct: 1, ...guideFigures(3) }, GUIDE_CREATED);
    store.writeCardPrices('intl', [{ cardId: 'sv01-172', prices: earlier }]);

    const stats = await refresh({
      fetch: fakeCardmarket(fixtureGuide('2026-11-21T02:43:56+0100')).fetch,
    });

    expect(stats.cards.unmapped).toBe(1);
    expect(store.getCardPrices('intl', 'sv01-172')).toBeDefined();
  });

  it('applies an unchanged guide anew once products changed', async () => {
    const { store, cardmarket, refresh } = await setup();
    await refresh();
    store.saveCardmarketProducts('intl', new Map([['sv01-172', PRODUCTS.pineco]]));

    const stats = await refresh();

    expect(cardmarket.requests).toBe(2);
    expect(stats.status).toBe('ok');
    expect(store.getCardPrices('intl', 'sv01-172')?.base?.trend).toBe(0.14);
  });

  describe('TCGdex’s products', () => {
    it('price a card when Cardmarket’s product list names them for it', async () => {
      const { store, refresh } = await setup();
      storeProductList(store, { [PRODUCTS.pineco]: 'Pineco [Guard Press]' });

      const stats = await refresh();

      expect(stats.cards.rejected).toBe(0);
      expect(store.getCardPrices('intl', 'sv01-001')?.base?.trend).toBe(0.14);
    });

    it('leave a card unpriced when the list names them for another card or printing', async () => {
      const { store, refresh } = await setup();
      await refresh();
      storeProductList(store, { [PRODUCTS.pineco]: 'Psyduck [Confusion Wave]' });
      const log = silentLogger();
      const info = vi.spyOn(log, 'info');

      const stats = await refresh({ log });

      expect(stats.cards.rejected).toBe(1);
      expect(store.getCardPrices('intl', 'sv01-001')).toBeUndefined();
      expect(info).toHaveBeenCalledWith(
        { count: 1, cards: ['intl:sv01-001'] },
        'catalog.cardmarket_products_rejected'
      );

      // Another printing's name: still rejected, so nothing to apply anew.
      storeProductList(store, { [PRODUCTS.pineco]: 'Pineco [Ram | Tackle]' }, '2026-11-25');
      expect((await refresh()).status).toBe('unchanged');
      expect(store.getCardPrices('intl', 'sv01-001')).toBeUndefined();
      // Rejected under another guide too.
      const next = await refresh({
        fetch: fakeCardmarket(fixtureGuide('2026-11-21T02:43:56+0100')).fetch,
      });
      expect(next.cards.rejected).toBe(1);
    });

    it('aren’t checked in a set released in the last 60 days, whose names can still change', async () => {
      const { store, refresh } = await setup();
      storeProductList(store, { [PRODUCTS.pineco]: 'Psyduck [Confusion Wave]' });
      const soonAfterRelease = new Date('2023-05-29T00:00:00.000Z'); // Fixture sets: 2023-03-31.

      const stats = await refresh({ now: () => soonAfterRelease });

      expect(stats.cards.rejected).toBe(0);
      expect(store.getCardPrices('intl', 'sv01-001')?.base?.trend).toBe(0.14);
      // Checked once 60 days old, the same guide applied anew as the rejections changed.
      const later = await refresh({ now: () => new Date('2023-05-31T00:00:00.000Z') });
      expect(later.status).toBe('ok');
      expect(later.cards.rejected).toBe(1);
    });

    it('aren’t checked for a product Cardmarket added in the last 60 days', async () => {
      const { store, refresh } = await setup();
      const list = parseProductList(
        cardmarketProductList([
          {
            idProduct: PRODUCTS.pineco,
            name: 'Psyduck [Confusion Wave]',
            idExpansion: 5001,
            dateAdded: '2026-11-01 10:00:00',
          },
        ])
      );
      store.replaceCardmarketProducts(list?.products ?? [], {
        etag: null,
        createdAt: '2026-11-24T12:00:00.000Z',
        checkedAt: '2026-11-24T12:00:00.000Z',
      });

      // A new promo in an old set: its product is three weeks old.
      expect((await refresh({ now: () => new Date('2026-11-24T12:00:00Z') })).cards.rejected).toBe(
        0
      );
      expect((await refresh({ now: () => new Date('2027-01-02T12:00:00Z') })).cards.rejected).toBe(
        1
      );
    });

    it('are checked a few hundred at a time, letting the server answer meanwhile', async () => {
      const { store, refresh } = await setup();
      // 1,200 more cards, copies of Pineco with its product.
      const stored = store.getSet('intl', 'sv01');
      const pineco = store.getCard('intl', 'sv01-001');
      if (!stored || !pineco) {
        throw new Error('fixture missing');
      }
      const copies = Array.from({ length: 1200 }, (_, index) => ({
        ...pineco,
        id: `sv01-copy${String(index)}`,
        sortIndex: 1000 + index,
      }));
      store.writeSet(stored.set, [...store.listSetCards('intl', 'sv01'), ...copies]);
      store.saveCardmarketProducts(
        'intl',
        new Map(copies.map((card) => [card.id, PRODUCTS.pineco]))
      );
      const yields = vi.spyOn(globalThis, 'setImmediate');

      const stats = await refresh();

      expect(stats.status).toBe('ok');
      expect(yields.mock.calls.length).toBeGreaterThanOrEqual(2); // 1,200 products, 500 a time.
      yields.mockRestore();
    });

    it('give way to a match made by hand, which is never checked', async () => {
      const { store, refresh } = await setup();
      storeProductList(store, { [PRODUCTS.pineco]: 'Psyduck [Confusion Wave]' });

      const stats = await refresh({
        matches: handMatches('intl', { 'sv01-001': PRODUCTS.pineco }),
      });

      expect(stats.cards.rejected).toBe(0);
      expect(store.getCardPrices('intl', 'sv01-001')).toMatchObject({ matchedByHand: true });
    });

    it('are applied anew, not skipped as unchanged, once the product list changes', async () => {
      const { store, cardmarket, refresh } = await setup();
      await refresh();
      storeProductList(store, { [PRODUCTS.pineco]: 'Psyduck [Confusion Wave]' });

      const stats = await refresh();

      expect(cardmarket.requests).toBe(2);
      expect(stats.status).toBe('ok');
      expect(stats.cards.rejected).toBe(1);
    });

    it('are checked when a card is priced again after its match by hand is cleared', async () => {
      const { store, refresh } = await setup();
      await refresh();
      const none = handMatches('intl', {});
      storeProductList(store, { [PRODUCTS.pineco]: 'Pineco [Guard Press]' });

      expect(repriceCard(store, none, 'intl', 'sv01-001')).toBe(true);
      expect(store.getCardPrices('intl', 'sv01-001')?.base?.trend).toBe(0.14);

      storeProductList(store, { [PRODUCTS.pineco]: 'Psyduck [Confusion Wave]' });
      repriceCard(store, none, 'intl', 'sv01-001');
      expect(store.getCardPrices('intl', 'sv01-001')).toBeUndefined();
    });
  });

  describe('recent cards without a product', () => {
    const SOON_AFTER_RELEASE = new Date('2023-04-20T03:00:00.000Z'); // Fixture sets: 2023-03-31.

    async function importedWithoutProducts() {
      const store = memoryCatalogStore();
      const fake = fakeTcgdex();
      withoutPricing(fake, '/en/cards/sv01-001', '/fr/cards/sv01-001');
      await importCatalog(store, fake);
      // TCGdex adds Cardmarket data some days after the release.
      const original = fakeTcgdex().routes;
      for (const path of ['/en/cards/sv01-001', '/fr/cards/sv01-001']) {
        fake.routes.set(path, original.get(path));
      }
      fake.calls.length = 0;
      return { store, fake };
    }

    it('are looked up on TCGdex, in their first language, and priced', async () => {
      const { store, fake } = await importedWithoutProducts();

      const stats = await runPriceRefresh({
        store,
        client: fakeClient(fake),
        languages: LANGUAGES,
        log: silentLogger(),
        fetch: fakeCardmarket().fetch,
        now: () => SOON_AFTER_RELEASE,
      });

      // sv01-172 has no Cardmarket data at all.
      expect([...fake.calls].sort()).toEqual(['/en/cards/sv01-001', '/en/cards/sv01-172']);
      expect(stats.lookups).toEqual({ checked: 2, mapped: 1, failed: 0 });
      expect(store.getCardPrices('intl', 'sv01-001')?.base?.trend).toBe(0.14);
    });

    it('are left to the weekly refresh once their set is older', async () => {
      const { store, fake } = await importedWithoutProducts();

      const stats = await runPriceRefresh({
        store,
        client: fakeClient(fake),
        languages: LANGUAGES,
        log: silentLogger(),
        fetch: fakeCardmarket().fetch,
        now: () => new Date('2023-06-30T03:00:00.000Z'),
      });

      expect(fake.calls).toEqual([]);
      expect(stats.lookups.checked).toBe(0);
    });

    it('are counted and skipped when TCGdex can’t serve them', async () => {
      const { store, fake } = await importedWithoutProducts();
      fake.routes.set('/en/cards/sv01-001', new Status(500));
      const log = silentLogger();

      const stats = await runPriceRefresh({
        store,
        client: fakeClient(fake),
        languages: LANGUAGES,
        log,
        fetch: fakeCardmarket().fetch,
        now: () => SOON_AFTER_RELEASE,
      });

      expect(stats.status).toBe('ok');
      expect(stats.lookups.failed).toBe(1);
      expect(log.warnings).toContain('catalog.product_lookups_failed');
    });
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

  it('keeps the guide’s entries only with its state, never one without the other', async () => {
    const { store, refresh } = await setup();
    await refresh();
    const state = store.getPriceGuideState();
    const cardmarket = fakeCardmarket(
      cardmarketGuide({ [PRODUCTS.promo]: guideFigures(9) }, '2026-11-21T02:43:56+0100')
    );
    // Fails after the per-region writes began, before the guide was kept.
    const writeCardPrices = vi.spyOn(store, 'writeCardPrices').mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    await expect(refresh({ fetch: cardmarket.fetch })).rejects.toThrow('disk full');

    expect(store.getPriceGuideState()).toEqual(state);
    expect(store.getPriceGuideEntries([PRODUCTS.promo]).get(PRODUCTS.promo)).toMatchObject({
      trend: 1.5,
    });
    writeCardPrices.mockRestore();
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

describe('readCapped', () => {
  it('reads a body up to the limit, and refuses a longer one without a length header', async () => {
    const chunked = (text: string) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(text));
            controller.close();
          },
        })
      );

    expect(await readCapped(chunked('{"ok":true}'), 64, 'Test')).toBe('{"ok":true}');
    await expect(readCapped(chunked('x'.repeat(65)), 64, 'Test')).rejects.toThrow(
      'Test: too large'
    );
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
