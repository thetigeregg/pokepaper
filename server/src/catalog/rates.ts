import { isExchangeRates, type ExchangeRates } from '@pokepaper/shared';
import type { CatalogLogger } from './ingest.js';
import type { CatalogStore } from './store.js';

/** The ECB's euro reference rates, updated each working day around 16:00 CET. */
export const ECB_RATES_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const FETCH_TIMEOUT_MS = 30_000;
/** The ECB lists about 30 currencies; anything far beyond that is not its feed. */
const MAX_RATES = 100;

/**
 * Exchange rates from the ECB's daily XML (`<Cube time="…">` holding
 * `<Cube currency="CHF" rate="0.9223"/>` entries), or null when it isn't
 * that: no day, no rates, or a rate that isn't a positive number.
 */
export function parseEcbRates(xml: string): ExchangeRates | null {
  const date = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  if (!date) {
    return null;
  }
  const rates: Record<string, number> = {};
  for (const match of xml.matchAll(
    /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]\s*\/>/g
  )) {
    const [, code, rate] = match;
    if (code && rate) {
      rates[code] = Number(rate);
    }
  }
  const parsed = { date, rates };
  const count = Object.keys(rates).length;
  return count > 0 && count <= MAX_RATES && isExchangeRates(parsed) ? parsed : null;
}

export interface RatesRefreshOptions {
  store: CatalogStore;
  log: CatalogLogger;
  signal?: AbortSignal;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

/**
 * Fetches the ECB's current rates and stores them when they're for a new
 * day. On any failure the stored rates stay (logged as
 * `catalog.rates_failed`); returns whether new rates were stored.
 */
export async function refreshExchangeRates(options: RatesRefreshOptions): Promise<boolean> {
  const { store, log } = options;
  const fetchFn = options.fetch ?? fetch;
  try {
    const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const response = await fetchFn(ECB_RATES_URL, {
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    });
    if (!response.ok) {
      throw new Error(`ECB rates: HTTP ${String(response.status)}`);
    }
    const rates = parseEcbRates(await response.text());
    if (!rates) {
      throw new Error('ECB rates: unexpected response');
    }
    if (store.getExchangeRates()?.date === rates.date) {
      return false;
    }
    store.saveExchangeRates(rates);
    log.info(
      { date: rates.date, currencies: Object.keys(rates.rates).length },
      'catalog.rates_updated'
    );
    return true;
  } catch (error: unknown) {
    if (!options.signal?.aborted) {
      log.warn({ err: error }, 'catalog.rates_failed');
    }
    return false;
  }
}
