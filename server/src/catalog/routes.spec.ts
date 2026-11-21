import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  catalogCardImageUrl,
  catalogSetImageUrl,
  type CatalogManifest,
  type CatalogPricePack,
  type CatalogSetPack,
} from '@pokepaper/shared';
import { testApp } from '../test-helpers.js';
import { CatalogImageCache } from './image-cache.js';
import { runCatalogIngest } from './ingest.js';
import { runPriceRefresh } from './prices.js';
import { CATALOG_RATE_LIMIT } from './routes.js';
import {
  Bytes,
  fakeClient,
  fakeTcgdex,
  memoryCatalogStore,
  silentLogger,
  Status,
  webp,
} from './test-helpers.js';

async function catalogApp() {
  const store = memoryCatalogStore();
  const fake = fakeTcgdex();
  await runCatalogIngest({
    store,
    client: fakeClient(fake),
    languages: ['en', 'fr', 'ja', 'zh-tw'],
    kind: 'full',
    log: silentLogger(),
  });
  fake.calls.length = 0;
  const images = new CatalogImageCache({
    dir: mkdtempSync(join(tmpdir(), 'pokepaper-images-')),
    fetch: fake.fetch,
  });
  const { app, headers } = testApp(undefined, {
    catalog: { store, images, languages: ['en', 'fr', 'ja', 'zh-tw'] },
  });
  return { app, headers, store, fake };
}

describe('catalog routes', () => {
  it('require a session', async () => {
    const { app } = await catalogApp();

    for (const url of [
      '/api/catalog/manifest',
      '/api/catalog/sets/intl/sv01',
      '/api/catalog/prices/intl',
      '/api/catalog/rates',
      '/images/catalog/cards/intl/sv01-001/en/low.webp',
    ]) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    }
  });

  it('serve a manifest of every series and set, revalidated by ETag', async () => {
    const { app, headers, store } = await catalogApp();

    const response = await app.inject({ method: 'GET', url: '/api/catalog/manifest', headers });
    const manifest = response.json<CatalogManifest>();

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-cache');
    expect(manifest.version).toBe(store.version());
    expect(manifest.languages).toEqual(['en', 'fr', 'ja', 'zh-tw']);
    expect(manifest.series.map((series) => `${series.region}:${series.id}`)).toEqual([
      'asia:SV',
      'intl:misc',
      'intl:sv',
    ]);
    expect(manifest.sets).toEqual([
      { region: 'asia', id: 'SV2a', hash: store.getSet('asia', 'SV2a')?.hash, cardCount: 1 },
      { region: 'intl', id: '2019sm-fr', hash: expect.any(String) as string, cardCount: 1 },
      { region: 'intl', id: 'sv01', hash: store.getSet('intl', 'sv01')?.hash, cardCount: 2 },
    ]);

    const etag = response.headers.etag as string;
    const again = await app.inject({
      method: 'GET',
      url: '/api/catalog/manifest',
      headers: { ...headers, 'if-none-match': etag },
    });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');
  });

  it('serve a set pack with its cards, revalidated by its hash', async () => {
    const { app, headers, store } = await catalogApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/catalog/sets/intl/sv01',
      headers,
    });
    const pack = response.json<CatalogSetPack>();

    expect(response.statusCode).toBe(200);
    expect(pack.hash).toBe(store.getSet('intl', 'sv01')?.hash);
    expect(response.headers.etag).toBe(`"${pack.hash}"`);
    expect(pack.set.names).toEqual({ en: 'Scarlet & Violet', fr: 'Écarlate et Violet' });
    expect(pack.cards.map((card) => card.id)).toEqual(['sv01-001', 'sv01-172']);

    const again = await app.inject({
      method: 'GET',
      url: '/api/catalog/sets/intl/sv01',
      headers: { ...headers, 'if-none-match': `W/"x", "${pack.hash}"` },
    });
    expect(again.statusCode).toBe(304);
  });

  it('serve the stored exchange rates, revalidated by their date', async () => {
    const { app, headers, store } = await catalogApp();
    const url = '/api/catalog/rates';

    expect((await app.inject({ method: 'GET', url, headers })).statusCode).toBe(404);

    const rates = { date: '2026-11-20', rates: { CHF: 0.9223, USD: 1.099 } };
    store.saveExchangeRates(rates);
    const response = await app.inject({ method: 'GET', url, headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"rates-2026-11-20"');
    expect(response.json()).toEqual(rates);

    const unchanged = await app.inject({
      method: 'GET',
      url,
      headers: { ...headers, 'if-none-match': '"rates-2026-11-20"' },
    });
    expect(unchanged.statusCode).toBe(304);

    store.saveExchangeRates({ date: '2026-11-21', rates: { CHF: 0.93 } });
    const next = await app.inject({
      method: 'GET',
      url,
      headers: { ...headers, 'if-none-match': '"rates-2026-11-20"' },
    });
    expect(next.statusCode).toBe(200);
    expect(next.json<{ date: string }>().date).toBe('2026-11-21');
  });

  it('serve a region’s prices, revalidated by its prices version', async () => {
    const { app, headers, store, fake } = await catalogApp();
    const url = '/api/catalog/prices/intl';

    const empty = await app.inject({ method: 'GET', url, headers });
    expect(empty.statusCode).toBe(200);
    expect(empty.json<CatalogPricePack>()).toEqual({
      region: 'intl',
      version: 0,
      currency: 'EUR',
      prices: {},
    });

    await runPriceRefresh({
      store,
      client: fakeClient(fake),
      languages: ['en', 'fr', 'ja', 'zh-tw'],
      log: silentLogger(),
    });
    const stale = await app.inject({
      method: 'GET',
      url,
      headers: { ...headers, 'if-none-match': empty.headers.etag as string },
    });
    const pack = stale.json<CatalogPricePack>();
    expect(stale.statusCode).toBe(200);
    expect(stale.headers['cache-control']).toBe('private, no-cache');
    expect(stale.headers.etag).toBe(`"prices-intl-${String(store.pricesVersion('intl'))}"`);
    expect(pack.version).toBe(store.pricesVersion('intl'));
    expect(pack.prices['sv01-001']).toEqual({
      updated: '2026-11-20T22:24:05.881Z',
      idProduct: 483559,
      base: { trend: 0.14, avg7: 0.14, avg30: 0.14 },
      reverseHolo: { trend: 0.28, avg7: 0.28, avg30: 0.28 },
    });

    const again = await app.inject({
      method: 'GET',
      url,
      headers: { ...headers, 'if-none-match': `W/${stale.headers.etag as string}` },
    });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');
  });

  it.each([
    '/api/catalog/prices/mars',
    '/api/catalog/sets/intl/nope',
    '/api/catalog/sets/mars/sv01',
    `/api/catalog/sets/intl/${'x'.repeat(81)}`,
  ])('answer 404 for %s', async (url) => {
    const { app, headers } = await catalogApp();

    const response = await app.inject({ method: 'GET', url, headers });

    expect(response.statusCode).toBe(404);
  });

  it.each([
    ['a weakened tag', (tag: string) => `W/${tag}`],
    ['a weakened tag with a compression suffix', (tag: string) => `W/${tag.slice(0, -1)}-gzip"`],
    ['a zstd suffix', (tag: string) => `${tag.slice(0, -1)}-zstd"`],
    ['a wildcard', () => '*'],
  ])('revalidate %s as unchanged', async (_case, echo) => {
    const { app, headers } = await catalogApp();
    const first = await app.inject({ method: 'GET', url: '/api/catalog/manifest', headers });

    const again = await app.inject({
      method: 'GET',
      url: '/api/catalog/manifest',
      headers: { ...headers, 'if-none-match': echo(first.headers.etag as string) },
    });

    expect(again.statusCode).toBe(304);
    expect(again.headers.etag).toBe(first.headers.etag);
  });

  it('answer revalidations without loading the manifest or pack', async () => {
    const { app, headers, store } = await catalogApp();
    const manifestTag = (await app.inject({ method: 'GET', url: '/api/catalog/manifest', headers }))
      .headers.etag as string;
    const packTag = `"${store.getSetHash('intl', 'sv01') ?? ''}"`;
    const manifest = vi.spyOn(store, 'manifest');
    const pack = vi.spyOn(store, 'getSetPack');

    const manifest304 = await app.inject({
      method: 'GET',
      url: '/api/catalog/manifest',
      headers: { ...headers, 'if-none-match': manifestTag },
    });
    const pack304 = await app.inject({
      method: 'GET',
      url: '/api/catalog/sets/intl/sv01',
      headers: { ...headers, 'if-none-match': packTag },
    });

    expect([manifest304.statusCode, pack304.statusCode]).toEqual([304, 304]);
    expect(manifest).not.toHaveBeenCalled();
    expect(pack).not.toHaveBeenCalled();
  });

  it('send a fresh manifest once the catalog changes', async () => {
    const { app, headers, store } = await catalogApp();
    const stale = (await app.inject({ method: 'GET', url: '/api/catalog/manifest', headers }))
      .headers.etag as string;
    store.deleteSet('intl', '2019sm-fr');

    const response = await app.inject({
      method: 'GET',
      url: '/api/catalog/manifest',
      headers: { ...headers, 'if-none-match': stale },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<CatalogManifest>().sets).toHaveLength(2);
  });

  it('serve a card scan from TCGdex once, then from disk', async () => {
    const { app, headers, fake } = await catalogApp();
    fake.routes.set('asset:fr/sv/sv01/001/high.webp', new Bytes(webp(200)));
    const url = catalogCardImageUrl({ region: 'intl', id: 'sv01-001' }, 'fr', 'high');

    const first = await app.inject({ method: 'GET', url, headers });
    const second = await app.inject({ method: 'GET', url, headers });

    expect(first.statusCode).toBe(200);
    expect(first.headers['content-type']).toBe('image/webp');
    expect(first.headers['cache-control']).toBe('private, max-age=604800');
    expect(first.rawPayload).toEqual(Buffer.from(webp(200)));
    expect(second.rawPayload).toEqual(first.rawPayload);
    expect(fake.calls).toEqual(['asset:fr/sv/sv01/001/high.webp']);
  });

  it('look up a scan path without loading the whole card', async () => {
    const { app, headers, fake, store } = await catalogApp();
    fake.routes.set('asset:en/sv/sv01/001/low.webp', new Bytes(webp()));
    const getCard = vi.spyOn(store, 'getCard');

    const response = await app.inject({
      method: 'GET',
      url: catalogCardImageUrl({ region: 'intl', id: 'sv01-001' }, 'en', 'low'),
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(getCard).not.toHaveBeenCalled();
  });

  it('serve set logos and symbols', async () => {
    const { app, headers, fake } = await catalogApp();
    fake.routes.set('asset:fr/sv/sv01/logo.webp', new Bytes(webp(10)));
    fake.routes.set(
      'asset:univ/sv/sv01/symbol.webp',
      new Bytes(webp(11), 'application/octet-stream')
    );
    const set = { region: 'intl' as const, id: 'sv01' };

    const logo = await app.inject({
      method: 'GET',
      url: catalogSetImageUrl(set, { kind: 'logo', language: 'fr' }),
      headers,
    });
    const symbol = await app.inject({
      method: 'GET',
      url: catalogSetImageUrl(set, { kind: 'symbol' }),
      headers,
    });

    expect(logo.statusCode).toBe(200);
    expect(symbol.statusCode).toBe(200);
    expect(symbol.headers['content-type']).toBe('image/webp');
  });

  it.each([
    ['a language the card has no scan in', '/images/catalog/cards/intl/sv01-172/fr/low.webp'],
    ['an unknown card', '/images/catalog/cards/intl/nope/en/low.webp'],
    ['an unsupported quality', '/images/catalog/cards/intl/sv01-001/en/huge.webp'],
    ['an unsupported language', '/images/catalog/cards/intl/sv01-001/es/low.webp'],
    ['an unknown region', '/images/catalog/cards/mars/sv01-001/en/low.webp'],
    ['a logo in a language the set lacks', '/images/catalog/sets/intl/sv01/logo/ja.webp'],
    ['a malformed logo name', '/images/catalog/sets/intl/sv01/logo/en.png'],
    ['an unknown set symbol', '/images/catalog/sets/intl/nope/symbol.webp'],
  ])('answer 404 for %s without asking TCGdex', async (_case, url) => {
    const { app, headers, fake } = await catalogApp();

    const response = await app.inject({ method: 'GET', url, headers });

    expect(response.statusCode).toBe(404);
    expect(fake.calls).toEqual([]);
  });

  it('answer 404 when TCGdex no longer has a linked scan, and 502 when it fails', async () => {
    const { app, headers, fake } = await catalogApp();
    fake.routes.set('asset:en/sv/sv01/001/low.webp', new Status(503));

    const missing = await app.inject({
      method: 'GET',
      url: '/images/catalog/cards/intl/sv01-172/en/low.webp',
      headers,
    });
    const failing = await app.inject({
      method: 'GET',
      url: '/images/catalog/cards/intl/sv01-001/en/low.webp',
      headers,
    });

    expect(missing.statusCode).toBe(404);
    expect(failing.statusCode).toBe(502);
    expect(failing.json()).toEqual({ error: 'image_unavailable' });
  });

  it('allow catalog downloads beyond the global rate limit', async () => {
    const { app, headers } = await catalogApp();

    for (const url of ['/api/catalog/manifest', '/api/catalog/sets/intl/sv01']) {
      const response = await app.inject({ method: 'GET', url, headers });
      expect(response.headers['x-ratelimit-limit']).toBe(String(CATALOG_RATE_LIMIT));
    }
  });

  it('allow image bursts beyond the global rate limit', async () => {
    const { app, headers, fake } = await catalogApp();
    fake.routes.set('asset:en/sv/sv01/001/low.webp', new Bytes(webp()));
    const url = '/images/catalog/cards/intl/sv01-001/en/low.webp';

    const response = await app.inject({ method: 'GET', url, headers });

    expect(response.headers['x-ratelimit-limit']).toBe(String(CATALOG_RATE_LIMIT));
  });
});
