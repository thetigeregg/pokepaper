import { vi } from 'vitest';
import {
  CARDMARKET_PRODUCTS_URL,
  cardmarketProductsDue,
  downloadCardmarketProducts,
  PRODUCTS_MAX_AGE_MS,
  PRODUCTS_RETRY_MS,
  refreshCardmarketProductsIfDue,
} from './cardmarket-products.js';
import {
  fakeCardmarket,
  fixtureProductList,
  memoryCatalogStore,
  silentLogger,
  Status,
} from './test-helpers.js';

describe('refreshCardmarketProductsIfDue', () => {
  const start = new Date('2026-11-24T12:00:00Z');

  async function stored() {
    const store = memoryCatalogStore();
    const products = fakeCardmarket(fixtureProductList());
    const fetch = vi.fn(products.fetch);
    const log = silentLogger();
    await refreshCardmarketProductsIfDue({ store, log, fetch, now: () => start });
    return { store, products, fetch, log };
  }

  it('downloads the product list when none is stored', async () => {
    const { store, fetch } = await stored();

    expect(fetch).toHaveBeenCalledWith(CARDMARKET_PRODUCTS_URL, expect.anything());
    expect(store.getCardmarketProduct(483559)?.name).toBe('Pineco [Guard Press]');
  });

  it('checks the stored list again only once it’s due', async () => {
    const { store, fetch, log } = await stored();
    const soon = new Date(start.getTime() + PRODUCTS_MAX_AGE_MS - 1);
    const due = new Date(start.getTime() + PRODUCTS_MAX_AGE_MS);

    await refreshCardmarketProductsIfDue({ store, log, fetch, now: () => soon });
    expect(fetch).toHaveBeenCalledTimes(1);

    await refreshCardmarketProductsIfDue({ store, log, fetch, now: () => due });
    expect(fetch).toHaveBeenCalledTimes(2);
    // Unchanged (304): only the check's time moves.
    expect(store.getCardmarketProductsState()?.checkedAt).toBe(due.toISOString());
  });

  it('logs a failed download, keeping the stored list', async () => {
    const { store, products, log } = await stored();
    products.current = new Status(503);
    const due = new Date(start.getTime() + PRODUCTS_MAX_AGE_MS);

    await refreshCardmarketProductsIfDue({ store, log, fetch: products.fetch, now: () => due });

    expect(log.warnings).toEqual(['catalog.cardmarket_products_failed']);
    expect(store.getCardmarketProduct(483559)).toBeDefined();
  });

  it('shares one download between callers, and waits an hour after a failure', async () => {
    const store = memoryCatalogStore();
    const products = fakeCardmarket(fixtureProductList());
    const fetch = vi.fn(products.fetch);
    const log = silentLogger();

    await Promise.all([
      refreshCardmarketProductsIfDue({ store, log, fetch, now: () => start }),
      refreshCardmarketProductsIfDue({ store, log, fetch, now: () => start }),
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);

    products.current = new Status(503);
    const due = new Date(start.getTime() + PRODUCTS_MAX_AGE_MS);
    await refreshCardmarketProductsIfDue({ store, log, fetch, now: () => due });
    expect(fetch).toHaveBeenCalledTimes(2);
    const soon = new Date(due.getTime() + PRODUCTS_RETRY_MS - 1);
    await refreshCardmarketProductsIfDue({ store, log, fetch, now: () => soon });
    expect(fetch).toHaveBeenCalledTimes(2);
    const later = new Date(due.getTime() + PRODUCTS_RETRY_MS);
    await refreshCardmarketProductsIfDue({ store, log, fetch, now: () => later });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('rethrows when aborted, without downloading', async () => {
    const store = memoryCatalogStore();
    const controller = new AbortController();
    controller.abort(new Error('stopping'));
    const fetch = vi.fn(() => Promise.reject(new Error('aborted')));

    await expect(
      refreshCardmarketProductsIfDue({
        store,
        log: silentLogger(),
        signal: controller.signal,
        fetch,
      })
    ).rejects.toThrow('stopping');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('downloadCardmarketProducts', () => {
  /** A fetch that answers once `respond` is called, recording the signal it got. */
  function heldFetch() {
    const products = fakeCardmarket(fixtureProductList());
    let respond = (): void => undefined;
    let signal: AbortSignal | undefined;
    const fetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(signal?.reason as Error);
        });
        respond = () => {
          resolve(products.fetch(url, init));
        };
      });
    });
    return {
      fetch,
      respond: (): void => {
        respond();
      },
      signal: () => signal,
    };
  }

  it('lets a caller stop waiting without stopping the download for the others', async () => {
    const store = memoryCatalogStore();
    const log = silentLogger();
    const { fetch, respond, signal } = heldFetch();
    const matcher = downloadCardmarketProducts({ store, log, fetch });
    const controller = new AbortController();
    const scheduled = downloadCardmarketProducts({ store, log, fetch, signal: controller.signal });

    controller.abort(new Error('stopping'));

    await expect(scheduled).rejects.toThrow('stopping');
    expect(signal()?.aborted).toBe(false);
    respond();
    await matcher;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.getCardmarketProduct(483559)).toBeDefined();
  });

  it('stops the download once every caller has stopped waiting, not counting it a failure', async () => {
    const store = memoryCatalogStore();
    const log = silentLogger();
    const { fetch, signal } = heldFetch();
    const [first, second] = [new AbortController(), new AbortController()];
    const one = downloadCardmarketProducts({ store, log, fetch, signal: first.signal });
    const two = downloadCardmarketProducts({ store, log, fetch, signal: second.signal });

    first.abort(new Error('stopping'));
    await expect(one).rejects.toThrow('stopping');
    expect(signal()?.aborted).toBe(false);
    second.abort(new Error('stopping'));
    await expect(two).rejects.toThrow('stopping');

    expect(signal()?.aborted).toBe(true);
    // Once the stopped download settles: an abort isn't a failed download,
    // so no hour's wait before the next.
    await new Promise((resolve) => setTimeout(resolve));
    expect(cardmarketProductsDue(store, new Date())).toBe(true);
  });

  it('starts a new download for a caller arriving after the last one stopped waiting', async () => {
    const store = memoryCatalogStore();
    const log = silentLogger();
    const held = heldFetch();
    const controller = new AbortController();
    const stopped = downloadCardmarketProducts({
      store,
      log,
      fetch: held.fetch,
      signal: controller.signal,
    });
    controller.abort(new Error('stopping'));
    // Before the stopped download has settled, the matcher asks.
    const matcher = downloadCardmarketProducts({ store, log, fetch: held.fetch });

    await expect(stopped).rejects.toThrow('stopping');
    expect(held.fetch).toHaveBeenCalledTimes(2);
    held.respond();
    await matcher;
    expect(store.getCardmarketProduct(483559)).toBeDefined();
  });

  it('counts a real failure that races the last abort as a failure', async () => {
    const store = memoryCatalogStore();
    const log = silentLogger();
    const controller = new AbortController();
    const now = new Date('2026-11-24T12:00:00Z');
    const download = downloadCardmarketProducts({
      store,
      log,
      now: () => now,
      signal: controller.signal,
      // Fails on its own, then the caller stops before the failure is handled.
      fetch: () => {
        queueMicrotask(() => {
          controller.abort(new Error('stopping'));
        });
        return Promise.reject(new Error('HTTP 503'));
      },
    });

    await expect(download).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve));
    expect(cardmarketProductsDue(store, now)).toBe(false);
  });
});
