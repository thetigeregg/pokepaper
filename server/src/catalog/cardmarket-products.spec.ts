import { vi } from 'vitest';
import {
  CARDMARKET_PRODUCTS_URL,
  PRODUCTS_MAX_AGE_MS,
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

  it('rethrows when aborted', async () => {
    const store = memoryCatalogStore();
    const controller = new AbortController();
    controller.abort(new Error('stopping'));

    await expect(
      refreshCardmarketProductsIfDue({
        store,
        log: silentLogger(),
        signal: controller.signal,
        fetch: () => Promise.reject(new Error('aborted')),
      })
    ).rejects.toThrow('aborted');
  });
});
