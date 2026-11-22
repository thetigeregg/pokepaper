import {
  CATALOG_LANGUAGE_REGION,
  CATALOG_REGIONS,
  type CatalogLanguage,
  type CatalogRegion,
} from '@pokepaper/shared';
import type { CatalogLogger } from './ingest.js';
import { inLanguageOrder } from './normalize.js';
import { parseGuideEntry, parseProductId, type StoredCardPrices } from './price-data.js';
import type { CatalogStore } from './store.js';
import type { TcgdexClient } from './tcgdex-client.js';

/** Cardmarket's price guide for Pokémon (game 6): every product's figures, regenerated daily. */
export const CARDMARKET_PRICE_GUIDE_URL =
  'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json';
const FETCH_TIMEOUT_MS = 120_000;
/** The guide is about 16 MB; anything far larger isn't it. */
const MAX_GUIDE_BYTES = 128 * 1024 * 1024;
/**
 * A guide holding fewer than this share of the products the catalog's cards
 * map to is refused, rather than unpricing most cards: a truncated or
 * otherwise broken download, not a market that vanished overnight.
 */
const MIN_FOUND_SHARE = 0.5;
/** …once the catalog maps enough products for the share to mean something. */
const MIN_PRODUCTS_FOR_SHARE = 100;
/**
 * Cards of sets released this recently whose product isn't known yet are
 * looked up on TCGdex each pass: it adds Cardmarket data some days after a
 * release, and the import, which records products, only refetches stored
 * cards weekly. Older cards without one are left to that weekly refresh.
 */
export const PRODUCT_LOOKUP_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PriceRefreshOptions {
  store: CatalogStore;
  /** Looks up products of recent cards without one (`PRODUCT_LOOKUP_DAYS`); none without it. */
  client?: TcgdexClient;
  /** Languages the catalog imports: a card is looked up in the first one it has. */
  languages?: readonly CatalogLanguage[];
  log: CatalogLogger;
  signal?: AbortSignal;
  /** Injected in tests. */
  fetch?: typeof fetch;
  now?: () => Date;
}

export interface PriceRefreshStats {
  /**
   * `unchanged`: the guide is the one last applied (304). `failed`: it
   * couldn't be downloaded or wasn't usable; prices stay as they were, the
   * pass doesn't count as done, and the next scheduled run tries again.
   */
  status: 'ok' | 'unchanged' | 'failed';
  /** When Cardmarket generated the guide applied (ISO timestamp). */
  guideCreatedAt: string | null;
  /** Products in the guide. */
  products: number;
  /**
   * `priced`: has prices. `unpriced`: its product has no figures, or isn't in
   * the guide. `unmapped`: no known Cardmarket product; left as it was.
   * `changed`: stored prices that changed.
   */
  cards: { priced: number; unpriced: number; unmapped: number; changed: number };
  /**
   * Recent cards without a product, looked up on TCGdex: `checked`, of which
   * `mapped` now have one and `failed` couldn't be fetched.
   */
  lookups: { checked: number; mapped: number; failed: number };
  /** Prices removed because their card left the catalog. */
  pruned: number;
  durationMs: number;
  /** Each region's prices version after the pass. */
  versions: Partial<Record<CatalogRegion, number>>;
}

type Json = Record<string, unknown>;

/**
 * Refreshes every card's Cardmarket prices from Cardmarket's own price guide
 * download: one request (an empty 304 when unchanged since the last one
 * applied), looked up by each card's Cardmarket product, which the import
 * records from TCGdex's card details (docs/catalog.md → Prices). Recent cards
 * without a product yet are looked up on TCGdex first. Cards without a
 * product keep whatever prices they had.
 *
 * A guide that can't be downloaded, isn't one, or lacks most of the
 * catalog's products changes nothing (`failed`). Only an abort or a
 * database error throws.
 */
export async function runPriceRefresh(options: PriceRefreshOptions): Promise<PriceRefreshStats> {
  const { store, log, signal } = options;
  const now = options.now ?? ((): Date => new Date());
  const startedAt = Date.now();
  const runId = store.startPriceRun(now());
  const stats: PriceRefreshStats = {
    status: 'ok',
    guideCreatedAt: null,
    products: 0,
    cards: { priced: 0, unpriced: 0, unmapped: 0, changed: 0 },
    lookups: { checked: 0, mapped: 0, failed: 0 },
    pruned: 0,
    durationMs: 0,
    versions: {},
  };
  const finish = (status: PriceRefreshStats['status']): PriceRefreshStats => {
    stats.status = status;
    stats.durationMs = Date.now() - startedAt;
    store.finishPriceRun(runId, status === 'failed' ? 'failed' : 'ok', stats, now());
    log[status === 'failed' ? 'warn' : 'info']({ stats }, 'catalog.prices_finished');
    return stats;
  };

  log.info({}, 'catalog.prices_started');
  try {
    await lookUpRecentProducts(options, stats, now());
    const previous = store.getPriceGuideState();
    const productsVersion = store.productsVersion();
    // Products changed since the guide was applied: apply it anew (no 304).
    const etag = previous?.productsVersion === productsVersion ? previous.etag : null;
    let download: GuideDownload | 'unchanged';
    try {
      download = await downloadGuide(options, etag);
    } catch (error: unknown) {
      if (signal?.aborted) {
        throw error;
      }
      log.warn({ err: error }, 'catalog.price_guide_failed');
      return finish('failed');
    }
    if (download === 'unchanged') {
      stats.guideCreatedAt = previous?.createdAt ?? null;
      return finish('unchanged');
    }
    stats.guideCreatedAt = download.createdAt;
    stats.products = download.entries.size;

    const regions = CATALOG_REGIONS.map((region) => ({
      region,
      products: store.listCardmarketProducts(region),
    }));
    const mapped = new Set(regions.flatMap(({ products }) => [...products.values()]));
    const found = [...mapped].filter((idProduct) => download.entries.has(idProduct)).length;
    if (mapped.size >= MIN_PRODUCTS_FOR_SHARE && found < mapped.size * MIN_FOUND_SHARE) {
      log.warn(
        { mapped: mapped.size, found, products: download.entries.size },
        'catalog.price_guide_incomplete'
      );
      return finish('failed');
    }

    for (const { region, products } of regions) {
      signal?.throwIfAborted();
      const entries = store.listCardIds(region).map((cardId) => {
        const idProduct = products.get(cardId);
        if (idProduct === undefined) {
          stats.cards.unmapped += 1;
          return null; // Left as it was: forgetting a product removes its prices.
        }
        const entry = download.entries.get(idProduct);
        const prices: StoredCardPrices | null = entry
          ? parseGuideEntry(entry, download.createdAt)
          : null;
        stats.cards[prices ? 'priced' : 'unpriced'] += 1;
        return { cardId, prices };
      });
      stats.cards.changed += store.writeCardPrices(
        region,
        entries.filter((entry) => entry !== null)
      );
      stats.pruned += store.pruneOrphanPrices(region);
      store.pruneOrphanProducts(region);
      stats.versions[region] = store.pricesVersion(region);
    }
    store.savePriceGuideState({
      etag: download.etag,
      createdAt: download.createdAt,
      productsVersion,
    });
    return finish('ok');
  } catch (error: unknown) {
    stats.durationMs = Date.now() - startedAt;
    const aborted = signal?.aborted ?? false;
    if (!aborted) {
      log.error({ err: error, stats }, 'catalog.prices_failed');
    }
    // As in the import: recording the run must not replace the original error.
    try {
      store.finishPriceRun(runId, aborted ? 'aborted' : 'failed', stats, now());
    } catch (recordError: unknown) {
      log.error({ err: recordError }, 'catalog.run_record_failed');
    }
    throw error;
  }
}

interface GuideDownload {
  etag: string | null;
  createdAt: string;
  /** Guide entries by product ID. */
  entries: Map<number, Json>;
}

/** The guide, or `unchanged` when it's still the one with `etag` (304). Throws when unusable. */
async function downloadGuide(
  options: PriceRefreshOptions,
  etag: string | null
): Promise<GuideDownload | 'unchanged'> {
  const fetchFn = options.fetch ?? fetch;
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const response = await fetchFn(CARDMARKET_PRICE_GUIDE_URL, {
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    headers: etag ? { 'If-None-Match': etag } : {},
  });
  if (response.status === 304 && etag) {
    return 'unchanged';
  }
  if (!response.ok) {
    throw new Error(`Cardmarket price guide: HTTP ${String(response.status)}`);
  }
  const guide = parseGuide(JSON.parse(await readCapped(response, MAX_GUIDE_BYTES)));
  if (!guide) {
    throw new Error('Cardmarket price guide: unexpected content');
  }
  return { etag: response.headers.get('etag'), ...guide };
}

/** The body as text, failing once it passes `maxBytes` (whatever the headers say). */
export async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
    throw new Error('Cardmarket price guide: too large');
  }
  const reader = response.body?.getReader();
  if (!reader) {
    return '';
  }
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return text + decoder.decode();
    }
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error('Cardmarket price guide: too large');
    }
    text += decoder.decode(value, { stream: true });
  }
}

/**
 * Looks up the products of recent cards without one on TCGdex (in the
 * first imported language each card has), recording those found. A card
 * TCGdex can't serve is counted and skipped: it's looked up again next pass.
 */
async function lookUpRecentProducts(
  options: PriceRefreshOptions,
  stats: PriceRefreshStats,
  now: Date
): Promise<void> {
  const { store, client, log, signal } = options;
  if (!client) {
    return;
  }
  const since = new Date(now.getTime() - PRODUCT_LOOKUP_DAYS * DAY_MS).toISOString().slice(0, 10);
  for (const region of CATALOG_REGIONS) {
    const languages = inLanguageOrder(
      (options.languages ?? []).filter((language) => CATALOG_LANGUAGE_REGION[language] === region)
    );
    const found = new Map<string, number>();
    let firstError: unknown;
    await Promise.all(
      store.listUnmappedCards(region, since).map(async (card) => {
        const language = languages.find((candidate) => card.text[candidate]);
        if (!language) {
          return;
        }
        stats.lookups.checked += 1;
        try {
          const idProduct = parseProductId(await client.card(language, card.id, signal));
          if (idProduct !== null) {
            found.set(card.id, idProduct);
          }
        } catch (error: unknown) {
          signal?.throwIfAborted();
          stats.lookups.failed += 1;
          firstError ??= error;
        }
      })
    );
    stats.lookups.mapped += store.saveCardmarketProducts(region, found);
    if (firstError !== undefined) {
      log.warn(
        { err: firstError, region, failed: stats.lookups.failed },
        'catalog.product_lookups_failed'
      );
    }
  }
}

/** `{ createdAt, priceGuides: [{ idProduct, … }] }`, or null when it isn't that. */
export function parseGuide(
  value: unknown
): { createdAt: string; entries: Map<number, Json> } | null {
  if (!isObject(value) || !Array.isArray(value['priceGuides'])) {
    return null;
  }
  const createdAt =
    typeof value['createdAt'] === 'string' ? Date.parse(value['createdAt']) : Number.NaN;
  if (Number.isNaN(createdAt)) {
    return null;
  }
  const entries = new Map<number, Json>();
  for (const entry of value['priceGuides'] as unknown[]) {
    if (
      isObject(entry) &&
      typeof entry['idProduct'] === 'number' &&
      Number.isSafeInteger(entry['idProduct'])
    ) {
      entries.set(entry['idProduct'], entry);
    }
  }
  return entries.size > 0 ? { createdAt: new Date(createdAt).toISOString(), entries } : null;
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
