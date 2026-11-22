import type { CatalogLanguage } from '@pokepaper/shared';
import { runCatalogIngest, type CatalogLogger } from './ingest.js';
import { runPriceRefresh } from './prices.js';
import { refreshExchangeRates } from './rates.js';
import type { CatalogRunKind, CatalogStore } from './store.js';
import { TcgdexClient } from './tcgdex-client.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface CatalogScheduleOptions {
  store: CatalogStore;
  languages: readonly CatalogLanguage[];
  /** Hours between the end of one import and the start of the next. */
  refreshHours: number;
  /** A run is a full refresh when the last one finished at least this long ago. */
  fullRefreshDays: number;
  /** A run refreshes prices too when the last price pass started at least this long ago. */
  pricesRefreshHours: number;
  log: CatalogLogger;
  /** Delay before the first run, so startup isn't slowed down. */
  initialDelayMs?: number;
  /** Injected in tests. */
  createClient?: (signal: AbortSignal) => TcgdexClient;
  /** Fetches from the ECB and Cardmarket (TCGdex goes through `createClient`); injected in tests. */
  fetch?: typeof fetch;
  now?: () => Date;
}

export interface CatalogSchedule {
  /** Cancels the next run and aborts (then awaits) a running one. */
  stop(): Promise<void>;
}

/** Light pass by default; a full refresh when none completed recently (or ever). */
export function nextRunKind(
  lastFull: Date | null,
  now: Date,
  fullRefreshDays: number
): CatalogRunKind {
  return lastFull && now.getTime() - lastFull.getTime() < fullRefreshDays * DAY_MS
    ? 'light'
    : 'full';
}

/**
 * Whether a run should refresh prices: none completed yet, or the last one
 * started at least `pricesRefreshHours` ago. Start times are compared so
 * that runs every 24 hours refresh prices every time, however long each
 * takes.
 */
export function pricesDue(lastStart: Date | null, now: Date, pricesRefreshHours: number): boolean {
  return !lastStart || now.getTime() - lastStart.getTime() >= pricesRefreshHours * HOUR_MS;
}

/**
 * Keeps the catalog current: one import shortly after startup, then one
 * every `refreshHours` after the previous finished, so runs never overlap.
 * Each run first refreshes the ECB's exchange rates (one small request,
 * stored only when new); after the import, it refreshes prices when they're
 * due (`pricesDue`).
 * Failures are logged and retried at the next interval.
 */
export function startCatalogSchedule(options: CatalogScheduleOptions): CatalogSchedule {
  const { store, log } = options;
  const now = options.now ?? ((): Date => new Date());
  const createClient =
    options.createClient ?? ((signal: AbortSignal): TcgdexClient => new TcgdexClient({ signal }));
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | null = null;

  // A previous process may have died mid-import.
  store.abandonRunningRuns(now());

  // A function, not the property: TypeScript would keep a narrowed value
  // across the awaits below.
  const aborted = (): boolean => controller.signal.aborted;

  const run = async (): Promise<void> => {
    // Rates first: one small request, so a new server has them long before
    // its first (hours-long) full import finishes.
    await refreshExchangeRates({
      store,
      log,
      signal: controller.signal,
      fetch: options.fetch,
    });
    if (aborted()) {
      return;
    }
    const client = createClient(controller.signal);
    try {
      const kind = nextRunKind(store.lastCompletedFullRun(), now(), options.fullRefreshDays);
      await runCatalogIngest({
        store,
        client,
        languages: options.languages,
        kind,
        log,
        signal: controller.signal,
      });
    } catch (error: unknown) {
      if (!aborted()) {
        log.error({ err: error }, 'catalog.scheduled_run_failed');
      }
    }
    // Prices are refreshed for whatever the catalog holds, even after a failed import.
    if (!aborted() && pricesDue(store.lastCompletedPriceRun(), now(), options.pricesRefreshHours)) {
      await refreshPrices(client);
    }
  };

  const refreshPrices = async (client: TcgdexClient): Promise<void> => {
    try {
      await runPriceRefresh({
        store,
        client,
        languages: options.languages,
        log,
        signal: controller.signal,
        fetch: options.fetch,
        now,
      });
    } catch (error: unknown) {
      if (!aborted()) {
        log.error({ err: error }, 'catalog.scheduled_prices_failed');
      }
    }
  };

  const schedule = (delayMs: number): void => {
    timer = setTimeout(() => {
      running = run().finally(() => {
        running = null;
        if (!controller.signal.aborted) {
          schedule(options.refreshHours * HOUR_MS);
        }
      });
    }, delayMs);
  };

  schedule(options.initialDelayMs ?? 10_000);

  return {
    async stop(): Promise<void> {
      clearTimeout(timer);
      controller.abort(new Error('Catalog schedule stopped'));
      await running;
    },
  };
}
