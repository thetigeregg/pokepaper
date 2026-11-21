import {
  CATALOG_LANGUAGE_REGION,
  CATALOG_REGIONS,
  type CatalogLanguage,
  type CatalogRegion,
} from '@pokepaper/shared';
import {
  fetchContained,
  isContainedFailure,
  MAX_CONSECUTIVE_SET_FAILURES,
  type CatalogLogger,
} from './ingest.js';
import { inLanguageOrder } from './normalize.js';
import { parseCardmarketPrices, type StoredCardPrices } from './price-data.js';
import type { CatalogStore } from './store.js';
import { TcgdexUnavailableError, type TcgdexClient } from './tcgdex-client.js';

export interface PriceRefreshOptions {
  store: CatalogStore;
  client: TcgdexClient;
  /** Languages the catalog imports: each card is fetched in the first one it has. */
  languages: readonly CatalogLanguage[];
  log: CatalogLogger;
  signal?: AbortSignal;
  /** Injected in tests. */
  now?: () => Date;
}

export interface PriceRefreshStats {
  /**
   * `partial`: some sets or cards couldn't be refreshed. `failed`: none
   * could (TCGdex looked down throughout), so the pass doesn't count as
   * done and the next scheduled run tries again.
   */
  status: 'ok' | 'partial' | 'failed';
  /**
   * `refreshed`: stored. `failed`: TCGdex was unavailable for the set, which
   * keeps its previous prices. `skipped`: not attempted because several
   * sets in a row failed.
   */
  sets: { seen: number; refreshed: number; failed: number; skipped: number };
  /**
   * Counted for refreshed sets only. `priced`/`unpriced`: fetched, with or
   * without Cardmarket prices. `skipped`: TCGdex couldn't serve the card
   * (404, malformed) or it has no imported language; it keeps its previous
   * prices. `unavailable`: TCGdex kept failing for the card (a few per set
   * are tolerated); it keeps its previous prices. `changed`: stored prices
   * that changed.
   */
  cards: {
    priced: number;
    unpriced: number;
    skipped: number;
    unavailable: number;
    changed: number;
  };
  /** Prices removed because their card left the catalog. */
  pruned: number;
  requests: number;
  durationMs: number;
  /** Each region's prices version after the pass. */
  versions: Partial<Record<CatalogRegion, number>>;
}

const PROGRESS_EVERY = 50;
/**
 * Cards in one set TCGdex may be unavailable for (after retries) before the
 * whole set fails: one broken card shouldn't freeze a set's prices, but
 * several mean TCGdex is struggling, and the set's remaining requests are
 * cancelled.
 */
const MAX_UNAVAILABLE_CARDS = 3;

type Json = Record<string, unknown>;

/**
 * Refreshes Cardmarket prices for every card in the catalog. TCGdex has
 * prices only in card details, and they're the same in every language of a
 * region, so each card is fetched once: in the first imported language it
 * has (English, else French, Italian, German; Japanese, else Chinese).
 *
 * Failures are contained like the import's: a card TCGdex can't serve
 * keeps its previous prices; a set fails, keeping its previous prices, when
 * TCGdex is unavailable for MAX_UNAVAILABLE_CARDS of its cards or all of
 * them; after MAX_CONSECUTIVE_SET_FAILURES failed sets in a row the rest of
 * the region is skipped. Only an abort or a database error ends the pass
 * early.
 */
export async function runPriceRefresh(options: PriceRefreshOptions): Promise<PriceRefreshStats> {
  const { store, client, log, signal } = options;
  const now = options.now ?? ((): Date => new Date());
  const startedAt = Date.now();
  const requestsBefore = client.requests;
  const runId = store.startPriceRun(now());
  const stats: PriceRefreshStats = {
    status: 'ok',
    sets: { seen: 0, refreshed: 0, failed: 0, skipped: 0 },
    cards: { priced: 0, unpriced: 0, skipped: 0, unavailable: 0, changed: 0 },
    pruned: 0,
    requests: 0,
    durationMs: 0,
    versions: {},
  };
  const measure = (): void => {
    stats.requests = client.requests - requestsBefore;
    stats.durationMs = Date.now() - startedAt;
  };

  log.info({ languages: options.languages }, 'catalog.prices_started');
  try {
    for (const region of CATALOG_REGIONS) {
      const languages = inLanguageOrder(
        options.languages.filter((language) => CATALOG_LANGUAGE_REGION[language] === region)
      );
      if (languages.length > 0) {
        await refreshRegion({ ...options, region, languages, stats });
      }
    }
  } catch (error: unknown) {
    measure();
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

  const missed = stats.sets.failed + stats.sets.skipped;
  if (missed > 0 && stats.sets.refreshed === 0) {
    stats.status = 'failed';
  } else if (missed > 0 || stats.cards.unavailable > 0) {
    stats.status = 'partial';
  }
  measure();
  store.finishPriceRun(runId, stats.status, stats, now());
  log.info({ stats }, 'catalog.prices_finished');
  return stats;
}

interface RegionContext extends PriceRefreshOptions {
  region: CatalogRegion;
  languages: CatalogLanguage[];
  stats: PriceRefreshStats;
}

async function refreshRegion(context: RegionContext): Promise<void> {
  const { store, region, stats, log } = context;
  const setIds = store.listSetIds(region);
  let consecutiveFailures = 0;
  let done = 0;
  for (const setId of setIds) {
    context.signal?.throwIfAborted();
    stats.sets.seen += 1;
    if (consecutiveFailures >= MAX_CONSECUTIVE_SET_FAILURES) {
      stats.sets.skipped += 1;
    } else {
      try {
        await refreshSet(context, setId);
        stats.sets.refreshed += 1;
        consecutiveFailures = 0;
      } catch (error: unknown) {
        if (!isContainedFailure(error)) {
          throw error;
        }
        stats.sets.failed += 1;
        log.warn({ err: error, region, setId }, 'catalog.prices_set_failed');
        consecutiveFailures += 1;
        if (consecutiveFailures === MAX_CONSECUTIVE_SET_FAILURES) {
          log.warn({ region, after: setId }, 'catalog.prices_region_interrupted');
        }
      }
    }
    done += 1;
    if (done % PROGRESS_EVERY === 0) {
      log.info({ region, done, total: setIds.length }, 'catalog.prices_progress');
    }
  }
  stats.pruned += store.pruneOrphanPrices(region);
  stats.versions[region] = store.pricesVersion(region);
}

/**
 * Fetches and stores the prices of one set's cards. Throws (storing
 * nothing) when TCGdex is unavailable for MAX_UNAVAILABLE_CARDS cards or for
 * every card it was asked for; fewer such cards keep their previous prices.
 */
async function refreshSet(context: RegionContext, setId: string): Promise<void> {
  const { store, client, region, languages, stats, log } = context;
  const entries: { cardId: string; prices: StoredCardPrices | null }[] = [];
  let skipped = 0;
  let unavailable = 0;
  let firstUnavailable: unknown;
  // Cancels the set's remaining requests once it's bound to fail.
  const cancel = new AbortController();
  const jobs = store.listSetCards(region, setId).map(async (card) => {
    const language = languages.find((candidate) => card.text[candidate]);
    if (!language) {
      skipped += 1;
      return;
    }
    try {
      const raw = await fetchContained(
        () => client.card(language, card.id, cancel.signal),
        (value) => value
      );
      if (!isObject(raw) || raw['id'] !== card.id) {
        skipped += 1;
        return;
      }
      entries.push({ cardId: card.id, prices: parseCardmarketPrices(raw) });
    } catch (error: unknown) {
      if (!cancel.signal.aborted && error instanceof TcgdexUnavailableError) {
        unavailable += 1;
        firstUnavailable ??= error;
        if (unavailable < MAX_UNAVAILABLE_CARDS) {
          return;
        }
      }
      cancel.abort(error);
      throw error;
    }
  });
  // Settle every request before deciding, so none outlives the set.
  const outcomes = await Promise.allSettled(jobs);
  const failure = outcomes.find((outcome) => outcome.status === 'rejected');
  if (failure) {
    throw failure.reason;
  }
  if (unavailable > 0 && entries.length === 0) {
    throw firstUnavailable;
  }

  stats.cards.changed += store.writeCardPrices(region, entries);
  for (const entry of entries) {
    stats.cards[entry.prices ? 'priced' : 'unpriced'] += 1;
  }
  stats.cards.skipped += skipped;
  stats.cards.unavailable += unavailable;
  if (unavailable > 0) {
    log.warn(
      { err: firstUnavailable, region, setId, unavailable },
      'catalog.prices_cards_unavailable'
    );
  }
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
