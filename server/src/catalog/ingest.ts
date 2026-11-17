import {
  CATALOG_LANGUAGE_REGION,
  CATALOG_REGIONS,
  type CatalogCard,
  type CatalogLanguage,
  type CatalogRegion,
} from '@pokepaper/shared';
import {
  inLanguageOrder,
  learnVocabulary,
  mergeCard,
  mergeSeries,
  mergeSet,
  parseCard,
  parseSeriesList,
  parseSetDetail,
  parseSetList,
  type RawCard,
  type RawSeries,
  type RawSetDetail,
  type Vocabulary,
} from './normalize.js';
import type { CatalogRunKind, CatalogStore } from './store.js';
import { TcgdexResponseError, TcgdexUnavailableError, type TcgdexClient } from './tcgdex-client.js';

/** The pino methods the import uses (Fastify's logger satisfies it). */
export interface CatalogLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface CatalogIngestOptions {
  store: CatalogStore;
  client: TcgdexClient;
  languages: readonly CatalogLanguage[];
  /**
   * `light`: refresh series and set listings, fetch only cards (or card
   * languages) not stored yet, drop what TCGdex removed. `full`: also
   * refetch every card, picking up corrections.
   */
  kind: CatalogRunKind;
  log: CatalogLogger;
  signal?: AbortSignal;
}

export interface CatalogIngestStats {
  kind: CatalogRunKind;
  status: 'ok' | 'partial';
  /** `empty`: listed by TCGdex but without any cards (stubs), so not stored. */
  sets: {
    seen: number;
    written: number;
    unchanged: number;
    empty: number;
    failed: number;
    removed: number;
  };
  cards: { fetched: number; skipped: number };
  /** Regions whose listings couldn't be loaded, so their sets weren't touched. */
  skippedRegions: CatalogRegion[];
  requests: number;
  durationMs: number;
  version: number;
}

const PROGRESS_EVERY = 50;

/**
 * Imports the catalogue from TCGdex into `catalog.db`. Failures are
 * contained: a set that can't be fetched keeps its previous data (the run
 * ends `partial`), and a card TCGdex can't serve (404, malformed) is skipped.
 * Only an abort or a database error ends the run early.
 */
export async function runCatalogIngest(options: CatalogIngestOptions): Promise<CatalogIngestStats> {
  const { store, client, kind, log, signal } = options;
  const startedAt = Date.now();
  const requestsBefore = client.requests;
  const runId = store.startRun(kind);
  const stats: CatalogIngestStats = {
    kind,
    status: 'ok',
    sets: { seen: 0, written: 0, unchanged: 0, empty: 0, failed: 0, removed: 0 },
    cards: { fetched: 0, skipped: 0 },
    skippedRegions: [],
    requests: 0,
    durationMs: 0,
    version: 0,
  };
  const finish = (): void => {
    stats.requests = client.requests - requestsBefore;
    stats.durationMs = Date.now() - startedAt;
    stats.version = store.version();
  };

  log.info({ kind, languages: options.languages }, 'catalog.ingest_started');
  try {
    for (const region of CATALOG_REGIONS) {
      const languages = inLanguageOrder(
        options.languages.filter((language) => CATALOG_LANGUAGE_REGION[language] === region)
      );
      if (languages.length > 0) {
        await ingestRegion({ ...options, region, languages, stats });
      }
    }
  } catch (error: unknown) {
    finish();
    const aborted = signal?.aborted ?? false;
    store.finishRun(runId, aborted ? 'aborted' : 'failed', stats);
    if (!aborted) {
      log.error({ err: error, stats }, 'catalog.ingest_failed');
    }
    throw error;
  }

  if (stats.sets.failed > 0 || stats.skippedRegions.length > 0) {
    stats.status = 'partial';
  }
  finish();
  store.finishRun(runId, stats.status, stats);
  log.info({ stats }, 'catalog.ingest_finished');
  return stats;
}

interface RegionContext extends CatalogIngestOptions {
  region: CatalogRegion;
  languages: CatalogLanguage[];
  stats: CatalogIngestStats;
}

async function ingestRegion(context: RegionContext): Promise<void> {
  const { store, client, region, languages, stats, log } = context;

  // Series: replaced only when every language's list loaded, so a flaky
  // response can't drop translations or whole series.
  const seriesLists = new Map<CatalogLanguage, RawSeries[]>();
  const setLists = new Map<CatalogLanguage, Set<string>>();
  const setOrder: string[] = [];
  try {
    for (const language of languages) {
      const series = parseSeriesList(await client.series(language));
      const sets = parseSetList(await client.sets(language));
      if (!series || !sets) {
        throw new TcgdexResponseError(`TCGdex ${language} listings are not lists`);
      }
      seriesLists.set(language, series);
      setLists.set(language, new Set(sets.map((set) => set.id)));
      for (const set of sets) {
        if (!setOrder.includes(set.id)) {
          setOrder.push(set.id);
        }
      }
    }
  } catch (error: unknown) {
    if (!isContainedFailure(error)) {
      throw error;
    }
    // Without complete listings, removals can't be told apart from gaps.
    log.warn({ err: error, region }, 'catalog.region_listings_unavailable');
    stats.skippedRegions.push(region);
    return;
  }

  store.replaceSeries(region, mergeSeries(region, seriesLists));

  const vocabularies = new Map<CatalogLanguage, Vocabulary>(
    languages.map((language) => [language, store.getVocabulary(language)])
  );

  // Sets to keep: stored or failed (a failed set keeps its previous data).
  const keep = new Set<string>();
  let done = 0;
  for (const setId of setOrder) {
    context.signal?.throwIfAborted();
    stats.sets.seen += 1;
    const setLanguages = languages.filter((language) => setLists.get(language)?.has(setId));
    try {
      const outcome = await ingestSet(context, setId, setLanguages, vocabularies);
      stats.sets[outcome] += 1;
      if (outcome !== 'empty') {
        keep.add(setId);
      }
    } catch (error: unknown) {
      if (!isContainedFailure(error)) {
        throw error;
      }
      stats.sets.failed += 1;
      keep.add(setId);
      log.warn({ err: error, region, setId }, 'catalog.set_failed');
    }

    done += 1;
    if (done % PROGRESS_EVERY === 0) {
      log.info({ region, done, total: setOrder.length }, 'catalog.ingest_progress');
    }
  }

  for (const setId of store.listSetIds(region)) {
    if (!keep.has(setId) && store.deleteSet(region, setId)) {
      stats.sets.removed += 1;
    }
  }

  for (const [language, vocabulary] of vocabularies) {
    if (vocabulary.size > 0) {
      store.saveVocabulary(language, vocabulary);
    }
  }
}

/** Fetches and stores one set. */
async function ingestSet(
  context: RegionContext,
  setId: string,
  setLanguages: readonly CatalogLanguage[],
  vocabularies: ReadonlyMap<CatalogLanguage, Vocabulary>
): Promise<'written' | 'unchanged' | 'empty'> {
  const { store, client, region, kind, stats } = context;

  const details = new Map<CatalogLanguage, RawSetDetail>();
  await Promise.all(
    setLanguages.map(async (language) => {
      const detail = await fetchContained(() => client.set(language, setId), parseSetDetail);
      if (detail) {
        details.set(language, detail);
      }
    })
  );
  const set = mergeSet(region, details);
  if (!set) {
    return 'empty';
  }

  // Card order: the preferred language's listing first, then cards only
  // other languages list.
  const cardLanguages = new Map<string, { localId: string; languages: CatalogLanguage[] }>();
  for (const language of inLanguageOrder(details.keys())) {
    for (const brief of details.get(language)?.cards ?? []) {
      const entry = cardLanguages.get(brief.id) ?? { localId: brief.localId, languages: [] };
      entry.languages.push(language);
      cardLanguages.set(brief.id, entry);
    }
  }

  const existing = new Map(store.listSetCards(region, setId).map((card) => [card.id, card]));
  const fetched = new Map<string, Map<CatalogLanguage, RawCard>>();
  const jobs: Promise<void>[] = [];
  for (const [cardId, entry] of cardLanguages) {
    for (const language of entry.languages) {
      if (kind === 'light' && existing.get(cardId)?.text[language]) {
        continue;
      }
      jobs.push(
        fetchContained(() => client.card(language, cardId), parseCard).then((raw) => {
          if (!raw || raw.id !== cardId) {
            stats.cards.skipped += 1;
            return;
          }
          stats.cards.fetched += 1;
          const printings = fetched.get(cardId) ?? new Map<CatalogLanguage, RawCard>();
          printings.set(language, raw);
          fetched.set(cardId, printings);
        })
      );
    }
  }
  // Settle every request before deciding, so none outlives the set.
  const outcomes = await Promise.allSettled(jobs);
  const failure = outcomes.find((outcome) => outcome.status === 'rejected');
  if (failure) {
    throw failure.reason;
  }

  if (region === 'intl') {
    for (const printings of fetched.values()) {
      const english = printings.get('en');
      if (!english) {
        continue;
      }
      for (const [language, raw] of printings) {
        const vocabulary = vocabularies.get(language);
        if (language !== 'en' && vocabulary) {
          learnVocabulary(english, raw, vocabulary);
        }
      }
    }
  }

  const cards: CatalogCard[] = [];
  for (const [cardId, entry] of cardLanguages) {
    const card = mergeCard({
      region,
      setId,
      localId: entry.localId,
      sortIndex: cards.length,
      languages: entry.languages,
      fetched: fetched.get(cardId) ?? new Map(),
      existing: existing.get(cardId),
      vocabularies,
    });
    if (card) {
      cards.push(card);
    }
  }

  if (cards.length === 0) {
    return 'empty';
  }
  return store.writeSet(set, cards) ? 'written' : 'unchanged';
}

/**
 * Runs a TCGdex request and parses it. Answers retrying can't fix (404,
 * malformed) become `null`; an unavailable TCGdex or an abort propagates.
 */
async function fetchContained<T>(
  request: () => Promise<unknown>,
  parse: (value: unknown) => T | null
): Promise<T | null> {
  try {
    const value = await request();
    return value === null ? null : parse(value);
  } catch (error: unknown) {
    if (error instanceof TcgdexResponseError) {
      return null;
    }
    throw error;
  }
}

/** Failures that skip one set or region rather than ending the run. */
function isContainedFailure(error: unknown): boolean {
  return error instanceof TcgdexUnavailableError || error instanceof TcgdexResponseError;
}
