import type { CatalogLogger } from './ingest.js';
import { readCapped } from './download.js';
import { isProductId } from './price-data.js';
import type { CardmarketProduct, CatalogStore } from './store.js';

/** Cardmarket's product list for Pokémon (game 6), single cards only: regenerated daily. */
export const CARDMARKET_PRODUCTS_URL =
  'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json';
const FETCH_TIMEOUT_MS = 120_000;
/** The list is about 14 MB; anything far larger isn't it. */
const MAX_PRODUCTS_BYTES = 128 * 1024 * 1024;
/** The stored list is checked for a newer one (with its ETag) once it's this old. */
export const PRODUCTS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** After a failed download, the list isn't checked again for this long. */
export const PRODUCTS_RETRY_MS = 60 * 60 * 1000;

export interface CardmarketProductsDownload {
  store: CatalogStore;
  log: CatalogLogger;
  signal?: AbortSignal;
  /** Injected in tests. */
  fetch?: typeof fetch;
  now?: () => Date;
}

type Json = Record<string, unknown>;

/**
 * Downloads Cardmarket's product list and stores it (`replaceCardmarketProducts`),
 * or records that the stored one is still current (304). Throws when it
 * can't be downloaded or isn't one; the stored list is left as it was.
 *
 * Callers at the same time share one download (`downloads`). Each waits with
 * its own `signal`: aborting it rejects that caller at once (with the
 * signal's reason), and the download itself stops only once every caller
 * still waiting has aborted. An abort isn't a failure (`PRODUCTS_RETRY_MS`).
 */
export function downloadCardmarketProducts(options: CardmarketProductsDownload): Promise<void> {
  const { store, signal } = options;
  if (signal?.aborted) {
    return Promise.reject(signal.reason as Error);
  }
  let shared = downloads.get(store);
  if (!shared) {
    const controller = new AbortController();
    const now = options.now ?? ((): Date => new Date());
    const promise = fetchProducts({ ...options, signal: controller.signal })
      .then(() => {
        failures.delete(store);
      })
      .catch((error: unknown) => {
        // Stopped, not failed: the rejection is the abort's own reason (a
        // real failure racing the abort still counts).
        if (!(controller.signal.aborted && error === controller.signal.reason)) {
          failures.set(store, now().getTime());
        }
        throw error;
      })
      .finally(() => {
        // A stopped download already gave its place to any newer one.
        if (downloads.get(store) === shared) {
          downloads.delete(store);
        }
      });
    shared = { store, promise, controller, waiting: 0 };
    downloads.set(store, shared);
  }
  return join(shared, signal);
}

interface SharedDownload {
  store: CatalogStore;
  promise: Promise<void>;
  /** Stops the download, once no caller waits on it any more. */
  controller: AbortController;
  /** Callers waiting on it that haven't aborted (one without a signal never does). */
  waiting: number;
}

/**
 * Downloads in progress, per store: the matcher and the scheduled price
 * pass share one. Kept per store, not per process, so tests stay apart.
 */
const downloads = new WeakMap<CatalogStore, SharedDownload>();

/** Waits on a shared download, until it settles or `signal` aborts. */
function join(shared: SharedDownload, signal: AbortSignal | undefined): Promise<void> {
  shared.waiting += 1;
  if (!signal) {
    return shared.promise;
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      shared.waiting -= 1;
      if (shared.waiting === 0) {
        // Out of the way first: a caller from now on starts a new download
        // rather than joining this stopped one.
        if (downloads.get(shared.store) === shared) {
          downloads.delete(shared.store);
        }
        shared.controller.abort(signal.reason);
      }
      reject(signal.reason as Error);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    shared.promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}
/** When each store's last download failed (ms since the epoch), until one succeeds. */
const failures = new WeakMap<CatalogStore, number>();

async function fetchProducts(options: CardmarketProductsDownload): Promise<void> {
  const { store, log } = options;
  const fetchFn = options.fetch ?? fetch;
  const now = options.now ?? ((): Date => new Date());
  const previous = store.getCardmarketProductsState();
  const startedAt = Date.now();
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const response = await fetchFn(CARDMARKET_PRODUCTS_URL, {
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    headers: previous?.etag ? { 'If-None-Match': previous.etag } : {},
  });
  const checkedAt = now().toISOString();
  if (response.status === 304 && previous?.etag) {
    store.saveCardmarketProductsState({ ...previous, checkedAt });
    return;
  }
  if (!response.ok) {
    throw new Error(`Cardmarket product list: HTTP ${String(response.status)}`);
  }
  const list = parseProductList(
    JSON.parse(await readCapped(response, MAX_PRODUCTS_BYTES, 'Cardmarket product list'))
  );
  if (!list) {
    throw new Error('Cardmarket product list: unexpected content');
  }
  store.replaceCardmarketProducts(list.products, {
    etag: response.headers.get('etag'),
    createdAt: list.createdAt,
    checkedAt,
  });
  // Parsing and storing run on the server's event loop: about a second, daily at most.
  log.info(
    { products: list.products.length, durationMs: Date.now() - startedAt },
    'catalog.cardmarket_products_stored'
  );
}

/**
 * Downloads the product list when none is stored or the stored one is due
 * a check (`cardmarketProductsDue`), before a price pass checks TCGdex's
 * products against it. A failed download is logged and leaves the stored
 * list as it was; only an abort throws.
 */
export async function refreshCardmarketProductsIfDue(
  options: CardmarketProductsDownload
): Promise<void> {
  const now = options.now ?? ((): Date => new Date());
  if (!cardmarketProductsDue(options.store, now())) {
    return;
  }
  try {
    await downloadCardmarketProducts(options);
  } catch (error: unknown) {
    if (options.signal?.aborted) {
      throw error;
    }
    options.log.warn({ err: error }, 'catalog.cardmarket_products_failed');
  }
}

/**
 * Whether the stored product list is missing or due a check for a newer one
 * (`PRODUCTS_MAX_AGE_MS` old), unless a download failed in the last
 * `PRODUCTS_RETRY_MS`.
 */
export function cardmarketProductsDue(store: CatalogStore, now: Date): boolean {
  const failed = failures.get(store);
  if (failed !== undefined && now.getTime() - failed < PRODUCTS_RETRY_MS) {
    return false;
  }
  const state = store.getCardmarketProductsState();
  return !state || now.getTime() - Date.parse(state.checkedAt) >= PRODUCTS_MAX_AGE_MS;
}

/**
 * `{ createdAt, products: [{ idProduct, name, idExpansion, dateAdded, … }] }`,
 * or null when it isn't that (or holds no usable product).
 */
export function parseProductList(
  value: unknown
): { createdAt: string; products: CardmarketProduct[] } | null {
  if (!isObject(value) || !Array.isArray(value['products'])) {
    return null;
  }
  const createdAt =
    typeof value['createdAt'] === 'string' ? Date.parse(value['createdAt']) : Number.NaN;
  if (Number.isNaN(createdAt)) {
    return null;
  }
  const products: CardmarketProduct[] = [];
  for (const entry of value['products'] as unknown[]) {
    if (
      isObject(entry) &&
      isProductId(entry['idProduct']) &&
      typeof entry['name'] === 'string' &&
      entry['name'].length > 0 &&
      typeof entry['idExpansion'] === 'number' &&
      Number.isSafeInteger(entry['idExpansion'])
    ) {
      products.push({
        idProduct: entry['idProduct'],
        name: entry['name'],
        idExpansion: entry['idExpansion'],
        dateAdded: parseDateAdded(entry['dateAdded']),
      });
    }
  }
  return products.length > 0 ? { createdAt: new Date(createdAt).toISOString(), products } : null;
}

/** `2015-11-12 15:08:09` → `2015-11-12`; Cardmarket's `0000-00-00 …` (unknown) → null. */
function parseDateAdded(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return date && date[1] !== '0000' ? `${date[1]}-${date[2]}-${date[3]}` : null;
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
