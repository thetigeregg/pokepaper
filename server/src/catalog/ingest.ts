import {
  CATALOG_LANGUAGE_REGION,
  CATALOG_REGIONS,
  type CatalogCard,
  type CatalogLanguage,
  type CatalogRegion,
} from '@pokepaper/shared';
import {
  inLanguageOrder,
  isAssetPath,
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
  /**
   * `empty`: listed by TCGdex but without any cards (stubs), so not stored.
   * `skipped`: not attempted because TCGdex looked down (several sets in a
   * row failed); they keep their previous data.
   */
  sets: {
    seen: number;
    written: number;
    unchanged: number;
    empty: number;
    failed: number;
    skipped: number;
    removed: number;
  };
  cards: { fetched: number; skipped: number };
  /**
   * Checks for scans TCGdex has but doesn't link (see `resolveUnlinkedImages`).
   * `failed`: checks that couldn't complete (retried next run).
   */
  images: { probed: number; found: number; failed: number };
  /** Regions whose listings couldn't be loaded, so their sets weren't touched. */
  skippedRegions: CatalogRegion[];
  requests: number;
  durationMs: number;
  version: number;
}

const PROGRESS_EVERY = 50;
/** Consecutive failed sets after which the rest of a region is skipped. */
const MAX_CONSECUTIVE_SET_FAILURES = 3;
/** How long a "no scan at the expected path" answer is trusted. */
const IMAGE_MISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Imports the catalog from TCGdex into `catalog.db`. Failures are
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
    sets: { seen: 0, written: 0, unchanged: 0, empty: 0, failed: 0, skipped: 0, removed: 0 },
    cards: { fetched: 0, skipped: 0 },
    images: { probed: 0, found: 0, failed: 0 },
    skippedRegions: [],
    requests: 0,
    durationMs: 0,
    version: 0,
  };
  const measure = (): void => {
    stats.requests = client.requests - requestsBefore;
    stats.durationMs = Date.now() - startedAt;
  };

  // Shared by both regions: they use the same asset host.
  const imageChecks: ImageCheckState = { failedSetsInARow: 0, paused: false };
  log.info({ kind, languages: options.languages }, 'catalog.ingest_started');
  try {
    for (const region of CATALOG_REGIONS) {
      const languages = inLanguageOrder(
        options.languages.filter((language) => CATALOG_LANGUAGE_REGION[language] === region)
      );
      if (languages.length > 0) {
        await ingestRegion({ ...options, region, languages, stats, imageChecks });
      }
    }
  } catch (error: unknown) {
    measure();
    const aborted = signal?.aborted ?? false;
    if (!aborted) {
      log.error({ err: error, stats }, 'catalog.ingest_failed');
    }
    // The error may be the database itself failing: recording the run must
    // not replace it (the run is marked aborted at the next start instead).
    try {
      store.finishRun(runId, aborted ? 'aborted' : 'failed', stats);
    } catch (recordError: unknown) {
      log.error({ err: recordError }, 'catalog.run_record_failed');
    }
    throw error;
  }

  if (
    stats.sets.failed > 0 ||
    stats.sets.skipped > 0 ||
    stats.skippedRegions.length > 0 ||
    stats.images.failed > 0
  ) {
    stats.status = 'partial';
  }
  measure();
  stats.version = store.version();
  store.finishRun(runId, stats.status, stats);
  log.info({ stats }, 'catalog.ingest_finished');
  return stats;
}

interface RegionContext extends CatalogIngestOptions {
  region: CatalogRegion;
  languages: CatalogLanguage[];
  stats: CatalogIngestStats;
  imageChecks: ImageCheckState;
}

/** Image checks pause for the rest of a run once the asset host looks down. */
interface ImageCheckState {
  failedSetsInARow: number;
  paused: boolean;
}

async function ingestRegion(context: RegionContext): Promise<void> {
  const { store, client, region, languages, stats, log } = context;

  // Series: replaced only when every language's list loaded, so a flaky
  // response can't drop translations or whole series.
  const seriesLists = new Map<CatalogLanguage, RawSeries[]>();
  const setLists = new Map<CatalogLanguage, Set<string>>();
  // Insertion-ordered: the preferred language's sets first.
  const setOrder = new Set<string>();
  try {
    const listings = await Promise.all(
      languages.map(async (language) => {
        const [series, sets] = await Promise.all([client.series(language), client.sets(language)]);
        return { language, series: parseSeriesList(series), sets: parseSetList(sets) };
      })
    );
    for (const { language, series, sets } of listings) {
      if (!series || !sets) {
        throw new TcgdexResponseError(`TCGdex ${language} listings are not lists`);
      }
      seriesLists.set(language, series);
      setLists.set(language, new Set(sets.map((set) => set.id)));
      for (const set of sets) {
        setOrder.add(set.id);
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

  // Sets to keep: stored, failed or skipped (those keep their previous data).
  const keep = new Set<string>();
  let done = 0;
  let consecutiveFailures = 0;
  for (const setId of setOrder) {
    context.signal?.throwIfAborted();
    stats.sets.seen += 1;
    if (consecutiveFailures >= MAX_CONSECUTIVE_SET_FAILURES) {
      // TCGdex looks down: don't spend hours retrying every remaining set.
      stats.sets.skipped += 1;
      keep.add(setId);
      continue;
    }
    const setLanguages = languages.filter((language) => setLists.get(language)?.has(setId));
    try {
      const outcome = await ingestSet(context, setId, setLanguages, vocabularies);
      stats.sets[outcome] += 1;
      if (outcome !== 'empty') {
        keep.add(setId);
      }
      consecutiveFailures = 0;
    } catch (error: unknown) {
      if (!isContainedFailure(error)) {
        throw error;
      }
      stats.sets.failed += 1;
      keep.add(setId);
      log.warn({ err: error, region, setId }, 'catalog.set_failed');
      consecutiveFailures += 1;
      if (consecutiveFailures === MAX_CONSECUTIVE_SET_FAILURES) {
        log.warn({ region, after: setId }, 'catalog.region_interrupted');
      }
    }

    done += 1;
    if (done % PROGRESS_EVERY === 0) {
      log.info({ region, done, total: setOrder.size }, 'catalog.ingest_progress');
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

  // Every language listing the set must have a usable detail. Otherwise the
  // set fails and keeps its stored data: rewriting it from the languages that
  // did load would drop the rest (or, with none, delete the set).
  const details = new Map<CatalogLanguage, RawSetDetail>();
  await Promise.all(
    setLanguages.map(async (language) => {
      const response = await client.set(language, setId);
      const detail = response === null ? null : parseSetDetail(response);
      if (!detail) {
        throw new TcgdexResponseError(`TCGdex ${language} set ${setId}: missing or unusable`);
      }
      details.set(language, detail);
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
  // The first unavailable error cancels the set's remaining requests: the set
  // fails either way, so retrying hundreds of them would only add load.
  const cancel = new AbortController();
  const jobs: Promise<void>[] = [];
  for (const [cardId, entry] of cardLanguages) {
    for (const language of entry.languages) {
      if (kind === 'light' && existing.get(cardId)?.text[language]) {
        continue;
      }
      jobs.push(
        fetchContained(() => client.card(language, cardId, cancel.signal), parseCard).then(
          (raw) => {
            if (!raw || raw.id !== cardId) {
              stats.cards.skipped += 1;
              return;
            }
            stats.cards.fetched += 1;
            const printings = fetched.get(cardId) ?? new Map<CatalogLanguage, RawCard>();
            printings.set(language, raw);
            fetched.set(cardId, printings);
          },
          (error: unknown) => {
            cancel.abort(error);
            throw error;
          }
        )
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
  await resolveUnlinkedImages(context, set.serieId, cards);
  return store.writeSet(set, cards) ? 'written' : 'unchanged';
}

/**
 * TCGdex's asset host has scans its card data doesn't link (measured: about
 * 38% of the unlinked Japanese ones). For each card language without an
 * image, check the path the scan would have: the card's linked path in
 * another language with this language swapped in, else
 * `{lang}/{serie}/{set}/{localId}`. A path counts only when both `low.webp`
 * and `high.webp` exist. Answers are remembered (hits forever, misses for
 * IMAGE_MISS_TTL_MS), so each path is checked about once.
 *
 * Remembered hits always apply. New checks are best effort: the first one
 * that fails cancels the set's others (retried next run), and after
 * MAX_CONSECUTIVE_SET_FAILURES sets in a row with failures, checking pauses
 * for the rest of the run.
 */
async function resolveUnlinkedImages(
  context: RegionContext,
  serieId: string,
  cards: CatalogCard[]
): Promise<void> {
  const { store, client, stats, imageChecks, log } = context;
  const now = Date.now();
  const toCheck: { path: string; apply: () => void }[] = [];

  for (const card of cards) {
    const linked = Object.values(card.text).find((text) => text.image)?.image;
    for (const [language, text] of Object.entries(card.text)) {
      if (text.image) {
        continue;
      }
      const path = linked
        ? `${language}/${linked.split('/').slice(1).join('/')}`
        : `${language}/${serieId}/${card.setId}/${card.localId}`;
      if (!isAssetPath(path)) {
        continue; // Built from TCGdex IDs, which are only length-checked.
      }
      const known = store.getImageProbe(path);
      if (known?.found) {
        text.image = path;
      } else if (!known || now - known.checkedAt.getTime() >= IMAGE_MISS_TTL_MS) {
        toCheck.push({
          path,
          apply: () => {
            text.image = path;
          },
        });
      }
    }
  }
  if (toCheck.length === 0 || imageChecks.paused) {
    return;
  }

  const cancel = new AbortController();
  const outcomes = await Promise.allSettled(
    toCheck.map(async ({ path, apply }) => {
      try {
        const found =
          (await client.assetExists(`${path}/low.webp`, cancel.signal)) &&
          (await client.assetExists(`${path}/high.webp`, cancel.signal));
        stats.images.probed += 1;
        store.saveImageProbe(path, found);
        if (found) {
          stats.images.found += 1;
          apply();
        }
      } catch (error: unknown) {
        if (isContainedFailure(error)) {
          cancel.abort(error);
        }
        throw error;
      }
    })
  );

  const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
  const fatal = failures.find((failure) => !isContainedFailure(failure.reason));
  if (fatal) {
    throw fatal.reason; // An abort or a database error.
  }
  if (failures.length === 0) {
    imageChecks.failedSetsInARow = 0;
    return;
  }

  stats.images.failed += failures.length;
  imageChecks.failedSetsInARow += 1;
  const firstError: unknown = failures[0]?.reason;
  log.warn(
    { err: firstError, setId: cards[0]?.setId, failed: failures.length },
    'catalog.image_checks_failed'
  );
  if (imageChecks.failedSetsInARow >= MAX_CONSECUTIVE_SET_FAILURES) {
    imageChecks.paused = true;
    log.warn({}, 'catalog.image_checks_paused');
  }
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
