import { openCatalogDatabase } from './db.js';
import type { CatalogLogger } from './ingest.js';
import { CatalogStore } from './store.js';
import { TcgdexClient, TCGDEX_API_BASE, TCGDEX_ASSET_BASE } from './tcgdex-client.js';

const ASSETS = 'https://assets.tcgdex.net';

/** A route answers with JSON, an HTTP status, or a function of the attempt number. */
export type FakeRoute = unknown;

export interface FakeTcgdex {
  fetch: typeof fetch;
  routes: Map<string, FakeRoute>;
  /** Paths requested, in order (one entry per attempt). */
  calls: string[];
}

/** Status-only answer for a fake route. */
export class Status {
  constructor(
    readonly status: number,
    readonly headers: Record<string, string> = {}
  ) {}
}

/** Binary answer for a fake route (images). */
export class Bytes {
  constructor(
    readonly data: Uint8Array<ArrayBuffer>,
    readonly contentType = 'image/webp'
  ) {}
}

/** A minimal valid WebP file (RIFF header + WEBP form type), padded to `size` bytes. */
export function webp(size = 64): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(Math.max(size, 12));
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  bytes.set(new TextEncoder().encode('WEBP'), 8);
  return bytes;
}

/**
 * Fake TCGdex keyed by path: API paths as `/en/sets/sv01`, asset-host paths
 * as `asset:fr/sv/sv01/001/low.webp`. Unknown paths answer 404.
 */
export function fakeTcgdex(initial: Record<string, FakeRoute> = tcgdexFixture()): FakeTcgdex {
  const routes = new Map(Object.entries(initial));
  const calls: string[] = [];
  const fetchFn = (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.startsWith(TCGDEX_ASSET_BASE)
      ? `asset:${url.slice(TCGDEX_ASSET_BASE.length)}`
      : decodeURIComponent(url.slice(TCGDEX_API_BASE.length));
    calls.push(path);
    const route = routes.has(path) ? routes.get(path) : new Status(404);
    if (route instanceof Status) {
      return Promise.resolve(new Response(null, { status: route.status, headers: route.headers }));
    }
    if (route instanceof Bytes) {
      return Promise.resolve(
        new Response(route.data, { headers: { 'content-type': route.contentType } })
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify(route), { headers: { 'content-type': 'application/json' } })
    );
  };
  return { fetch: fetchFn, routes, calls };
}

export function fakeClient(fake: FakeTcgdex, signal?: AbortSignal): TcgdexClient {
  return new TcgdexClient({ fetch: fake.fetch, sleep: () => Promise.resolve(), signal });
}

export function memoryCatalogStore(): CatalogStore {
  return new CatalogStore(openCatalogDatabase(':memory:'));
}

export function silentLogger(): CatalogLogger & { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  return {
    warnings,
    errors,
    info: () => undefined,
    warn: (_obj, msg) => warnings.push(msg),
    error: (_obj, msg) => errors.push(msg),
  };
}

/**
 * A card's `pricing` in TCGdex's real response shape: Cardmarket's price
 * guide in euros, with `-holo` figures for the reverse holo (0 or null when
 * Cardmarket has none).
 */
export function tcgdexPricing(trend: number, trendHolo = 0, updated = '2026-11-20T22:24:05.881Z') {
  return {
    cardmarket: {
      updated,
      unit: 'EUR',
      idProduct: 483559,
      avg: trend,
      low: 0.02,
      trend,
      avg1: trend,
      avg7: trend,
      avg30: trend,
      'avg-holo': trendHolo || null,
      'low-holo': trendHolo ? 0.02 : null,
      'trend-holo': trendHolo,
      'avg1-holo': trendHolo || null,
      'avg7-holo': trendHolo || null,
      'avg30-holo': trendHolo || null,
    },
    tcgplayer: null,
  };
}

function brief(id: string, localId: string, language: string, path: string) {
  return { id, localId, name: id, image: `${ASSETS}/${language}/${path}/${localId}` };
}

function setDetail(
  language: string,
  id: string,
  name: string,
  serie: string,
  path: string,
  cards: [string, string][]
) {
  return {
    id,
    name,
    serie: { id: serie, name: serie },
    releaseDate: '2023-03-31',
    cardCount: { total: cards.length, official: cards.length },
    abbreviation: { official: id.toUpperCase() },
    logo: `${ASSETS}/${language}/${path}/logo`,
    symbol: `${ASSETS}/univ/${path}/symbol`,
    legal: { standard: false, expanded: true },
    cards: cards.map(([cardId, localId]) => brief(cardId, localId, language, path)),
  };
}

/**
 * A small slice of TCGdex in its real response shapes:
 * - `intl`: `sv01` in English and French (one card French-less: its French
 *   detail is missing), plus `2019sm-fr`, a French-only promo set.
 * - `asia`: `SV2a` in Japanese and Traditional Chinese, with one malformed
 *   card (no name).
 */
export function tcgdexFixture(): Record<string, FakeRoute> {
  const pineco = (language: 'en' | 'fr') =>
    language === 'en'
      ? {
          id: 'sv01-001',
          localId: '001',
          name: 'Pineco',
          category: 'Pokemon',
          rarity: 'Common',
          hp: 60,
          types: ['Grass'],
          stage: 'Basic',
          dexId: [204],
          illustrator: 'Shigenori Negishi',
          description: 'It spits out a fluid that it uses to glue tree bark to its body.',
          attacks: [{ cost: ['Colorless', 'Colorless'], name: 'Guard Press', damage: 10 }],
          weaknesses: [{ type: 'Fire', value: '×2' }],
          retreat: 2,
          regulationMark: 'G',
          variants: { normal: true, reverse: true, holo: false, firstEdition: false },
          legal: { standard: false, expanded: true },
          image: `${ASSETS}/en/sv/sv01/001`,
          pricing: tcgdexPricing(0.14, 0.28),
        }
      : {
          id: 'sv01-001',
          localId: '001',
          name: 'Pomdepik',
          category: 'Pokémon',
          rarity: 'Commune',
          hp: 60,
          types: ['Plante'],
          stage: 'Base',
          dexId: [204],
          description: 'Il crache un fluide qui lui sert à coller des écorces sur son corps.',
          attacks: [{ cost: ['Incolore', 'Incolore'], name: 'Pression de Garde', damage: 10 }],
          weaknesses: [{ type: 'Feu', value: '×2' }],
          retreat: 2,
          image: `${ASSETS}/fr/sv/sv01/001`,
        };

  return {
    '/en/series': [{ id: 'sv', name: 'Scarlet & Violet', logo: `${ASSETS}/en/sv/sv01/logo` }],
    '/fr/series': [
      { id: 'sv', name: 'Écarlate et Violet' },
      { id: 'misc', name: 'Divers' },
    ],
    '/en/sets': [{ id: 'sv01' }],
    '/fr/sets': [{ id: 'sv01' }, { id: '2019sm-fr' }],
    '/en/sets/sv01': setDetail('en', 'sv01', 'Scarlet & Violet', 'sv', 'sv/sv01', [
      ['sv01-001', '001'],
      ['sv01-172', '172'],
    ]),
    '/fr/sets/sv01': setDetail('fr', 'sv01', 'Écarlate et Violet', 'sv', 'sv/sv01', [
      ['sv01-001', '001'],
      ['sv01-172', '172'],
    ]),
    '/fr/sets/2019sm-fr': setDetail('fr', '2019sm-fr', 'Promos 2019', 'misc', 'misc/2019sm-fr', [
      ['2019sm-fr-1', '1'],
    ]),
    '/en/cards/sv01-001': pineco('en'),
    '/fr/cards/sv01-001': pineco('fr'),
    '/en/cards/sv01-172': {
      id: 'sv01-172',
      localId: '172',
      name: 'Energy Search',
      category: 'Trainer',
      rarity: 'Common',
      trainerType: 'Item',
      effect: 'Search your deck for a Basic Energy card, reveal it, and put it into your hand.',
      image: `${ASSETS}/en/sv/sv01/172`,
    },
    // '/fr/cards/sv01-172' is deliberately missing (404).
    '/fr/cards/2019sm-fr-1': {
      id: '2019sm-fr-1',
      localId: '1',
      name: 'Pomdepik',
      category: 'Pokémon',
      rarity: 'Commune',
      types: ['Plante'],
      stage: 'Base',
      attacks: [{ cost: ['Incolore'], name: 'Charge', damage: '10+' }],
      weaknesses: [{ type: 'Feu', value: '×2' }],
      pricing: tcgdexPricing(1.5),
    },

    '/ja/series': [{ id: 'SV', name: 'スカーレット&バイオレット' }],
    '/zh-tw/series': [{ id: 'SV', name: '朱&紫' }],
    '/ja/sets': [{ id: 'SV2a' }],
    '/zh-tw/sets': [{ id: 'SV2a' }],
    '/ja/sets/SV2a': setDetail('ja', 'SV2a', 'ポケモンカード151', 'SV', 'SV/SV2a', [
      ['SV2a-001', '001'],
      ['SV2a-002', '002'],
    ]),
    '/zh-tw/sets/SV2a': setDetail('zh-tw', 'SV2a', '寶可夢卡牌151', 'SV', 'SV/SV2a', [
      ['SV2a-001', '001'],
    ]),
    '/ja/cards/SV2a-001': {
      id: 'SV2a-001',
      localId: '001',
      name: 'フシギダネ',
      category: 'Pokemon',
      rarity: 'Common',
      hp: 70,
      types: ['Grass'],
      stage: 'Basic',
      dexId: [1],
      attacks: [{ cost: ['Grass', 'Colorless'], name: 'やどりぎのタネ', damage: 20 }],
      image: `${ASSETS}/ja/SV/SV2a/001`,
      pricing: tcgdexPricing(0.02, 8.33),
    },
    '/zh-tw/cards/SV2a-001': {
      id: 'SV2a-001',
      localId: '001',
      name: '妙蛙種子',
      category: 'Pokemon',
      rarity: 'Common',
      hp: 70,
      types: ['Grass'],
      stage: 'Basic',
      dexId: [1],
      attacks: [{ cost: ['Grass', 'Colorless'], name: '寄生種子', damage: 20 }],
      image: `${ASSETS}/zh-tw/SV/SV2a/001`,
    },
    '/ja/cards/SV2a-002': { id: 'SV2a-002', localId: '002', category: 'Pokemon' },
  };
}

/** An ECB daily rates document for `date`, with CHF at `chf` (and USD, unless left out). */
export function ecbXml(date: string, chf: number, usd: number | null = null): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <Cube>
    <Cube time='${date}'>
${usd === null ? '' : `      <Cube currency='USD' rate='${String(usd)}'/>\n`}      <Cube currency='CHF' rate='${String(chf)}'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;
}
