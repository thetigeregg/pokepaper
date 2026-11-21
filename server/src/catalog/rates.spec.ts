import { vi } from 'vitest';
import { ECB_RATES_URL, parseEcbRates, refreshExchangeRates } from './rates.js';
import { ecbXml, memoryCatalogStore } from './test-helpers.js';

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('parseEcbRates', () => {
  it('reads the day and every currency’s rate per euro', () => {
    expect(parseEcbRates(ecbXml('2026-11-20', 0.9223, 1.099))).toEqual({
      date: '2026-11-20',
      rates: { USD: 1.099, CHF: 0.9223 },
    });
  });

  it.each([
    ['not XML', 'Service unavailable'],
    ['no day', ecbXml('2026-11-20', 0.92).replace("time='2026-11-20'", '')],
    ['no rates', ecbXml('2026-11-20', 0.92).replace(/<Cube currency[^>]+>/g, '')],
    ['a zero rate', ecbXml('2026-11-20', 0)],
    ['an unreadable rate', ecbXml('2026-11-20', 0.92).replace("rate='0.92'", "rate='0.9.2'")],
  ])('returns null for %s', (_label, xml) => {
    expect(parseEcbRates(xml)).toBeNull();
  });
});

describe('refreshExchangeRates', () => {
  it('stores rates for a new day, and only then', async () => {
    const store = memoryCatalogStore();
    const log = logger();
    const fetch = vi.fn(() => Promise.resolve(new Response(ecbXml('2026-11-20', 0.92))));

    expect(await refreshExchangeRates({ store, log, fetch })).toBe('updated');
    expect(fetch).toHaveBeenCalledWith(ECB_RATES_URL, expect.anything());
    expect(store.getExchangeRates()).toEqual({ date: '2026-11-20', rates: { CHF: 0.92 } });
    expect(log.info).toHaveBeenCalledWith(
      { date: '2026-11-20', currencies: 1 },
      'catalog.rates_updated'
    );

    expect(await refreshExchangeRates({ store, log, fetch })).toBe('unchanged');
  });

  it.each([
    ['the ECB is unreachable', () => Promise.reject(new Error('offline'))],
    ['the ECB answers with an error', () => Promise.resolve(new Response('', { status: 503 }))],
    ['the response isn’t rates', () => Promise.resolve(new Response('<html></html>'))],
  ])('keeps the stored rates when %s', async (_label, fetch) => {
    const store = memoryCatalogStore();
    store.saveExchangeRates({ date: '2026-11-19', rates: { CHF: 0.91 } });
    const log = logger();

    expect(await refreshExchangeRates({ store, log, fetch })).toBe('failed');
    expect(store.getExchangeRates()?.date).toBe('2026-11-19');
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) as unknown }),
      'catalog.rates_failed'
    );
  });

  it('logs nothing when stopped', async () => {
    const controller = new AbortController();
    controller.abort();
    const log = logger();

    await refreshExchangeRates({
      store: memoryCatalogStore(),
      log,
      signal: controller.signal,
      fetch: () => Promise.reject(new Error('aborted')),
    });

    expect(log.warn).not.toHaveBeenCalled();
  });
});
