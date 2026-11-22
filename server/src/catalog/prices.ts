import { CATALOG_REGIONS, type CatalogRegion } from '@pokepaper/shared';
import type { CatalogLogger } from './ingest.js';
import { parseGuideEntry, type StoredCardPrices } from './price-data.js';
import type { CatalogStore } from './store.js';

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

export interface PriceRefreshOptions {
  store: CatalogStore;
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
   * the guide. `unmapped`: no known Cardmarket product (TCGdex has none).
   * `changed`: stored prices that changed.
   */
  cards: { priced: number; unpriced: number; unmapped: number; changed: number };
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
 * records from TCGdex's card details (docs/catalog.md → Prices).
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
    const previous = store.getPriceGuideState();
    let download: GuideDownload | 'unchanged';
    try {
      download = await downloadGuide(options, previous?.etag ?? null);
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
          return { cardId, prices: null };
        }
        const entry = download.entries.get(idProduct);
        const prices: StoredCardPrices | null = entry
          ? parseGuideEntry(entry, download.createdAt)
          : null;
        stats.cards[prices ? 'priced' : 'unpriced'] += 1;
        return { cardId, prices };
      });
      stats.cards.changed += store.writeCardPrices(region, entries);
      stats.pruned += store.pruneOrphanPrices(region);
      store.pruneOrphanProducts(region);
      stats.versions[region] = store.pricesVersion(region);
    }
    store.savePriceGuideState({ etag: download.etag, createdAt: download.createdAt });
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
  if (Number(response.headers.get('content-length') ?? 0) > MAX_GUIDE_BYTES) {
    throw new Error('Cardmarket price guide: too large');
  }
  const guide = parseGuide(JSON.parse(await response.text()));
  if (!guide) {
    throw new Error('Cardmarket price guide: unexpected content');
  }
  return { etag: response.headers.get('etag'), ...guide };
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
