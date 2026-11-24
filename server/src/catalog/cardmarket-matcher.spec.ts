import type { CatalogLanguage } from '@pokepaper/shared';
import { memoryDb } from '../test-helpers.js';
import {
  CARDMARKET_PRODUCTS_URL,
  CardmarketMatcher,
  CardmarketProductsUnavailableError,
  MAX_CANDIDATES,
  parseProductList,
  PRODUCTS_MAX_AGE_MS,
  PRODUCTS_RETRY_MS,
} from './cardmarket-matcher.js';
import { runCatalogIngest } from './ingest.js';
import { CardmarketMatchStore } from './matches-store.js';
import { runPriceRefresh } from './prices.js';
import { cardmarketMatchName, cardmarketSearchText } from './store.js';
import {
  cardmarketGuide,
  cardmarketProductList,
  EXPANSIONS,
  fakeCardmarket,
  fakeClient,
  fakeTcgdex,
  fixtureProductList,
  guideFigures,
  memoryCatalogStore,
  PRODUCTS,
  silentLogger,
  Status,
  UNMAPPED_PRODUCTS,
} from './test-helpers.js';

const LANGUAGES: CatalogLanguage[] = ['en', 'fr', 'ja', 'zh-tw'];
const GUIDE_CREATED = '2026-11-20T01:43:56.000Z';

function guide() {
  return cardmarketGuide({
    [PRODUCTS.pineco]: guideFigures(0.14, 0.28),
    [PRODUCTS.promo]: guideFigures(1.5),
    [PRODUCTS.japanese]: guideFigures(0.02, 8.33),
    [UNMAPPED_PRODUCTS.energySearch]: guideFigures(0.5),
    [UNMAPPED_PRODUCTS.megaMewtwo]: guideFigures(12),
  });
}

async function setup(options: { priced?: boolean; productList?: unknown } = {}) {
  const store = memoryCatalogStore();
  await runCatalogIngest({
    store,
    client: fakeClient(fakeTcgdex()),
    languages: LANGUAGES,
    kind: 'full',
    log: silentLogger(),
  });
  const matches = new CardmarketMatchStore(memoryDb());
  const prices = fakeCardmarket(guide());
  const refresh = () =>
    runPriceRefresh({ store, matches, log: silentLogger(), fetch: prices.fetch });
  if (options.priced ?? true) {
    await refresh();
  }
  const products = fakeCardmarket(options.productList ?? fixtureProductList());
  const log = silentLogger();
  const clock = { now: new Date('2026-11-24T12:00:00Z') };
  const matcher = new CardmarketMatcher({
    store,
    matches,
    log,
    fetch: (input, init) => products.fetch(input, init), // Swappable in tests.
    now: () => clock.now,
  });
  return { store, matches, matcher, products, prices, refresh, log, clock };
}

describe('cardmarketSearchText / cardmarketMatchName', () => {
  it('compare names by their letters and digits only', () => {
    expect(cardmarketSearchText('M Mewtwo EX')).toBe('mmewtwoex');
    expect(cardmarketSearchText('MMewtwo-EX')).toBe('mmewtwoex');
    expect(cardmarketSearchText('Flabébé')).toBe('flabebe');
    expect(cardmarketMatchName('MMewtwo EX [Vanishing Strike]')).toBe('mmewtwoex');
    expect(cardmarketMatchName('Beedrill [Allergic Shock | Twineedle]')).toBe('beedrill');
  });
});

describe('CardmarketMatcher.candidates', () => {
  it('suggests products named like the card in its set’s expansions, by product ID', async () => {
    const { matcher, products } = await setup();

    const candidates = await matcher.candidates('intl', 'sv01-172');

    expect(candidates).toEqual({
      current: null,
      truncated: false,
      searched: false,
      products: [
        {
          idProduct: UNMAPPED_PRODUCTS.energySearch,
          name: 'Energy Search',
          added: '2023-03-31',
          inSet: true,
          prices: {
            updated: GUIDE_CREATED,
            idProduct: UNMAPPED_PRODUCTS.energySearch,
            base: { trend: 0.5, avg7: 0.5, avg30: 0.5 },
            reverseHolo: null,
          },
        },
        {
          idProduct: UNMAPPED_PRODUCTS.energySearchFullArt,
          name: 'Energy Search',
          added: null,
          inSet: true,
          prices: null,
        },
      ],
    });
    expect(products.requests).toBe(1);
  });

  it('narrows same-named products to those sharing an attack with the card', async () => {
    const { matcher } = await setup();

    const named = await matcher.candidates('intl', 'sv01-001');
    const searched = await matcher.candidates('intl', 'sv01-001', 'pineco');

    expect(named?.products.map((product) => product.idProduct)).toEqual([PRODUCTS.pineco]);
    expect(searched?.products.map((product) => product.idProduct)).toEqual([
      PRODUCTS.pineco,
      UNMAPPED_PRODUCTS.pinecoOtherAttack,
      PRODUCTS.promo,
    ]);
  });

  it('falls back to the same name in any expansion when its set has none', async () => {
    const { store, matcher } = await setup();
    // Its set no longer maps to any expansion.
    store.saveCardmarketProducts('intl', new Map([['2019sm-fr-1', null]]));

    const candidates = await matcher.candidates('intl', '2019sm-fr-1');

    expect(candidates?.products.map((product) => [product.idProduct, product.inSet])).toEqual([
      [UNMAPPED_PRODUCTS.pomdepik, false],
    ]);
  });

  it('falls back to the whole expansion when no product has the card’s name', async () => {
    const { matcher } = await setup();

    // Japanese names never match Cardmarket's English ones.
    const candidates = await matcher.candidates('asia', 'SV2a-001');

    expect(candidates?.products.map((product) => product.name)).toEqual(['Bulbasaur']);
  });

  it('offers nothing to suggest without a matching name or a known expansion', async () => {
    const { store, matcher } = await setup();
    store.saveCardmarketProducts('asia', new Map([['SV2a-001', null]]));

    const candidates = await matcher.candidates('asia', 'SV2a-001');

    expect(candidates).toEqual({
      current: null,
      products: [],
      truncated: false,
      searched: false,
    });
  });

  it('searches every product name, the set’s expansions first, ignoring spaces', async () => {
    const { matcher } = await setup();

    const energy = await matcher.candidates('intl', 'sv01-172', 'energy');
    const mewtwo = await matcher.candidates('intl', 'sv01-172', 'M Mewtwo');

    expect(energy?.products.map((product) => [product.idProduct, product.inSet])).toEqual([
      [UNMAPPED_PRODUCTS.energySearch, true],
      [UNMAPPED_PRODUCTS.energySearchFullArt, true],
      [UNMAPPED_PRODUCTS.energySearchElsewhere, false],
    ]);
    expect(mewtwo?.products.map((product) => product.name)).toEqual([
      'MMewtwo EX [Vanishing Strike]',
    ]);
  });

  it('treats a search shorter than two letters as none, and says so', async () => {
    const { matcher } = await setup();

    const short = await matcher.candidates('intl', 'sv01-172', ' e ');
    const japanese = await matcher.candidates('intl', 'sv01-172', 'フシギダネ');
    const searched = await matcher.candidates('intl', 'sv01-172', 'energy');

    expect(short?.products).toHaveLength(2);
    expect([short?.searched, japanese?.searched, searched?.searched]).toEqual([false, false, true]);
  });

  it('caps the products offered and says so', async () => {
    const many = Array.from({ length: MAX_CANDIDATES + 5 }, (_, index) => ({
      idProduct: 900000 + index,
      name: 'Energy Search',
      idExpansion: EXPANSIONS.sv01,
    }));
    const { matcher } = await setup({
      productList: cardmarketProductList([
        { idProduct: PRODUCTS.pineco, name: 'Pineco', idExpansion: EXPANSIONS.sv01 },
        ...many,
      ]),
    });

    const candidates = await matcher.candidates('intl', 'sv01-172');

    expect(candidates?.products).toHaveLength(MAX_CANDIDATES);
    expect(candidates?.truncated).toBe(true);
  });

  it('reports the card’s current product, by TCGdex or by hand', async () => {
    const { matcher } = await setup();

    expect((await matcher.candidates('intl', 'sv01-001'))?.current).toEqual({
      idProduct: PRODUCTS.pineco,
      matchedByHand: false,
      name: 'Pineco [Guard Press]',
    });
    await matcher.match('intl', 'sv01-172', UNMAPPED_PRODUCTS.energySearch);
    expect((await matcher.candidates('intl', 'sv01-172'))?.current).toEqual({
      idProduct: UNMAPPED_PRODUCTS.energySearch,
      matchedByHand: true,
      name: 'Energy Search',
    });
  });

  it('offers products without prices before any price guide is stored', async () => {
    const { matcher } = await setup({ priced: false });

    const candidates = await matcher.candidates('intl', 'sv01-172', 'energy');

    expect(candidates?.products.map((product) => product.prices)).toEqual([null, null, null]);
  });

  it('is undefined for an unknown card, without downloading anything', async () => {
    const { matcher, products } = await setup();

    expect(await matcher.candidates('intl', 'nope-1')).toBeUndefined();
    expect(products.requests).toBe(0);
  });
});

describe('Cardmarket’s product list', () => {
  it('is downloaded once a day, then checked with its ETag', async () => {
    const { matcher, products, store, clock } = await setup();
    await matcher.candidates('intl', 'sv01-172');
    await matcher.candidates('intl', 'sv01-172');
    expect(products.requests).toBe(1);

    clock.now = new Date(clock.now.getTime() + PRODUCTS_MAX_AGE_MS);
    await matcher.candidates('intl', 'sv01-172');
    await matcher.settled();

    expect(products.requests).toBe(2); // An empty 304.
    expect(store.getCardmarketProductsState()).toMatchObject({
      createdAt: '2026-11-24T12:07:30.000Z',
      checkedAt: clock.now.toISOString(),
    });
  });

  it('is downloaded once for concurrent requests', async () => {
    const { matcher, products } = await setup();

    await Promise.all([
      matcher.candidates('intl', 'sv01-172'),
      matcher.candidates('intl', 'sv01-001'),
    ]);

    expect(products.requests).toBe(1);
  });

  it('is replaced whole by a newer one', async () => {
    const { matcher, products, clock } = await setup();
    await matcher.candidates('intl', 'sv01-172');
    products.current = cardmarketProductList([
      { idProduct: 600099, name: 'Energy Search', idExpansion: EXPANSIONS.sv01 },
    ]);

    clock.now = new Date(clock.now.getTime() + PRODUCTS_MAX_AGE_MS);
    // Answered from the stored list while the newer one downloads.
    const stale = await matcher.candidates('intl', 'sv01-172');
    await matcher.settled();
    const fresh = await matcher.candidates('intl', 'sv01-172');

    expect(stale?.products).toHaveLength(2);
    // Pineco's product is gone too, so the set maps to no expansion now.
    expect(fresh?.products.map((product) => [product.idProduct, product.inSet])).toEqual([
      [600099, false],
    ]);
  });

  it('keeps the stored list when a check fails, checking again an hour later', async () => {
    const { matcher, products, clock, log } = await setup();
    await matcher.candidates('intl', 'sv01-172');
    products.current = new Status(503);

    clock.now = new Date(clock.now.getTime() + PRODUCTS_MAX_AGE_MS);
    const candidates = await matcher.candidates('intl', 'sv01-172');
    await matcher.settled();
    await matcher.candidates('intl', 'sv01-172');

    expect(candidates?.products).toHaveLength(2);
    expect(log.warnings).toEqual(['catalog.cardmarket_products_failed']);
    expect(products.requests).toBe(2);

    clock.now = new Date(clock.now.getTime() + PRODUCTS_RETRY_MS);
    products.current = fixtureProductList();
    await matcher.candidates('intl', 'sv01-172');
    await matcher.settled();
    expect(products.requests).toBe(3);
    expect(log.warnings).toHaveLength(1);
  });

  it('never makes an answer wait for a check', async () => {
    const { matcher, products, clock } = await setup();
    await matcher.candidates('intl', 'sv01-172');
    let release: () => void = () => undefined;
    products.fetch = () =>
      new Promise((resolve) => {
        release = () => {
          resolve(new Response(null, { status: 503 }));
        };
      });

    clock.now = new Date(clock.now.getTime() + PRODUCTS_MAX_AGE_MS);
    const candidates = await matcher.candidates('intl', 'sv01-172');

    expect(candidates?.products).toHaveLength(2);
    release();
    await matcher.settled();
  });

  it('is unavailable when it can’t be downloaded and none is stored', async () => {
    for (const current of [new Status(500), 'not json', { createdAt: 'x', products: [] }]) {
      const { matcher } = await setup({ productList: current });

      await expect(matcher.candidates('intl', 'sv01-172')).rejects.toBeInstanceOf(
        CardmarketProductsUnavailableError
      );
    }
  });

  it('is fetched from Cardmarket', async () => {
    const urls: string[] = [];
    const { store, matches } = await setup();
    const matcher = new CardmarketMatcher({
      store,
      matches,
      log: silentLogger(),
      fetch: (input) => {
        urls.push(input instanceof Request ? input.url : input.toString());
        return Promise.resolve(new Response(JSON.stringify(fixtureProductList())));
      },
    });

    await matcher.candidates('intl', 'sv01-172');

    expect(urls).toEqual([CARDMARKET_PRODUCTS_URL]);
  });
});

describe('CardmarketMatcher.match / clear', () => {
  it('match a card and price it at once, flagged as matched by hand', async () => {
    const { store, matcher, matches } = await setup();
    const version = store.pricesVersion('intl');

    expect(await matcher.match('intl', 'sv01-172', UNMAPPED_PRODUCTS.energySearch)).toBe('ok');

    expect(matches.get('intl', 'sv01-172')).toBe(UNMAPPED_PRODUCTS.energySearch);
    expect(store.getPricePack('intl').prices['sv01-172']).toEqual({
      updated: GUIDE_CREATED,
      idProduct: UNMAPPED_PRODUCTS.energySearch,
      matchedByHand: true,
      base: { trend: 0.5, avg7: 0.5, avg30: 0.5 },
      reverseHolo: null,
    });
    expect(store.pricesVersion('intl')).toBeGreaterThan(version);
  });

  it('win over TCGdex’s product, and clearing goes back to it', async () => {
    const { store, matcher } = await setup();

    await matcher.match('intl', 'sv01-001', UNMAPPED_PRODUCTS.megaMewtwo);
    expect(store.getCardPrices('intl', 'sv01-001')).toMatchObject({
      idProduct: UNMAPPED_PRODUCTS.megaMewtwo,
      matchedByHand: true,
    });

    expect(matcher.clear('intl', 'sv01-001')).toBe(true);
    expect(store.getCardPrices('intl', 'sv01-001')).toEqual(
      expect.not.objectContaining({ matchedByHand: true })
    );
    expect(store.getCardPrices('intl', 'sv01-001')?.idProduct).toBe(PRODUCTS.pineco);
  });

  it('clearing a card without a TCGdex product removes its prices', async () => {
    const { store, matcher, matches } = await setup();
    await matcher.match('intl', 'sv01-172', UNMAPPED_PRODUCTS.energySearch);

    matcher.clear('intl', 'sv01-172');

    expect(matches.get('intl', 'sv01-172')).toBeUndefined();
    expect(store.getCardPrices('intl', 'sv01-172')).toBeUndefined();
  });

  it('matching a product without figures leaves the card unpriced', async () => {
    const { store, matcher } = await setup();

    await matcher.match('intl', 'sv01-172', UNMAPPED_PRODUCTS.energySearchFullArt);

    expect(store.getCardPrices('intl', 'sv01-172')).toBeUndefined();
  });

  it('keep their prices when a full import forgets TCGdex’s product', async () => {
    const { store, matcher, matches } = await setup();
    await matcher.match('intl', 'sv01-001', UNMAPPED_PRODUCTS.megaMewtwo);
    const fake = fakeTcgdex();
    for (const path of ['/en/cards/sv01-001', '/fr/cards/sv01-001']) {
      fake.routes.set(path, {
        ...(fake.routes.get(path) as object),
        pricing: { cardmarket: null },
      });
    }

    await runCatalogIngest({
      store,
      client: fakeClient(fake),
      languages: LANGUAGES,
      kind: 'full',
      matches,
      log: silentLogger(),
    });

    expect(store.getCardmarketProductOf('intl', 'sv01-001')).toBeUndefined();
    expect(store.getCardPrices('intl', 'sv01-001')).toMatchObject({
      idProduct: UNMAPPED_PRODUCTS.megaMewtwo,
      matchedByHand: true,
    });
  });

  it('are kept by later price passes', async () => {
    const { store, matcher, refresh, prices } = await setup();
    await matcher.match('intl', 'sv01-001', UNMAPPED_PRODUCTS.megaMewtwo);
    await matcher.match('intl', 'sv01-172', UNMAPPED_PRODUCTS.energySearch);
    const requests = prices.requests;

    const stats = await refresh();

    // Matches changed since the guide was applied: it's downloaded whole, not a 304.
    expect(stats.status).toBe('ok');
    expect(prices.requests).toBe(requests + 1);
    expect(stats.cards).toMatchObject({ priced: 4, unmapped: 0 });
    expect(store.getCardPrices('intl', 'sv01-001')).toMatchObject({
      idProduct: UNMAPPED_PRODUCTS.megaMewtwo,
      matchedByHand: true,
      base: { trend: 12 },
    });
    expect(store.getCardPrices('intl', 'sv01-172')).toMatchObject({
      idProduct: UNMAPPED_PRODUCTS.energySearch,
      matchedByHand: true,
    });
    expect((await refresh()).status).toBe('unchanged');
  });

  it('a match made before any price guide is stored is priced by the next pass', async () => {
    const { store, matcher, refresh } = await setup({ priced: false });

    await matcher.match('intl', 'sv01-172', UNMAPPED_PRODUCTS.energySearch);
    expect(store.getCardPrices('intl', 'sv01-172')).toBeUndefined();

    await refresh();
    expect(store.getCardPrices('intl', 'sv01-172')).toMatchObject({ matchedByHand: true });
  });

  it('refuse unknown cards and products', async () => {
    const { matcher, matches } = await setup();

    expect(await matcher.match('intl', 'nope-1', UNMAPPED_PRODUCTS.energySearch)).toBe(
      'unknown_card'
    );
    expect(await matcher.match('intl', 'sv01-172', 123)).toBe('unknown_product');
    expect(matcher.clear('intl', 'nope-1')).toBe(false);
    expect(matches.list('intl').size).toBe(0);
  });

  it('clearing a card without a match changes nothing', async () => {
    const { store, matcher, matches } = await setup();
    const version = store.pricesVersion('intl');

    expect(matcher.clear('intl', 'sv01-001')).toBe(true);

    expect(matches.version()).toBe(0);
    expect(store.pricesVersion('intl')).toBe(version);
  });
});

describe('CardmarketMatchStore', () => {
  it('replaces a card’s match and bumps its version only on changes', () => {
    const matches = new CardmarketMatchStore(memoryDb());

    matches.save('intl', 'xy8-63', 286309);
    matches.save('intl', 'xy8-63', 286309);
    expect(matches.version()).toBe(1);
    matches.save('intl', 'xy8-63', 286405);
    matches.save('asia', 'xy8-63', 1);

    expect(matches.version()).toBe(3);
    expect(Object.fromEntries(matches.list('intl'))).toEqual({ 'xy8-63': 286405 });
    expect(matches.remove('intl', 'xy8-63')).toBe(true);
    expect(matches.remove('intl', 'xy8-63')).toBe(false);
    expect(matches.version()).toBe(4);
    expect(matches.get('asia', 'xy8-63')).toBe(1);
  });
});

describe('parseProductList', () => {
  it('reads single cards, skipping malformed entries', () => {
    expect(
      parseProductList({
        createdAt: '2026-11-24T13:07:30+0100',
        products: [
          { idProduct: 1, name: 'Weedle', idExpansion: 2, dateAdded: '0000-00-00 00:00:00' },
          { idProduct: 3, name: 'Kakuna', idExpansion: 2, dateAdded: '2015-11-12 15:08:09' },
          { idProduct: -1, name: 'Bad', idExpansion: 2 },
          { idProduct: 4, name: '', idExpansion: 2 },
          { idProduct: 5, name: 'No expansion' },
          { idProduct: 6, name: 'No date', idExpansion: 2 },
          'junk',
        ],
      })
    ).toEqual({
      createdAt: '2026-11-24T12:07:30.000Z',
      products: [
        { idProduct: 1, name: 'Weedle', idExpansion: 2, dateAdded: null },
        { idProduct: 3, name: 'Kakuna', idExpansion: 2, dateAdded: '2015-11-12' },
        { idProduct: 6, name: 'No date', idExpansion: 2, dateAdded: null },
      ],
    });
  });

  it('refuses anything else', () => {
    for (const value of [null, [], { products: [] }, { createdAt: 'nope', products: [] }]) {
      expect(parseProductList(value)).toBeNull();
    }
  });
});
