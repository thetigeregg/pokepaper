import type { CatalogLanguage } from '@pokepaper/shared';
import { runCatalogIngest, type CatalogLogger } from './ingest.js';
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
  log: CatalogLogger;
  /** Delay before the first run, so startup isn't slowed down. */
  initialDelayMs?: number;
  /** Injected in tests. */
  createClient?: (signal: AbortSignal) => TcgdexClient;
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
 * Keeps the catalogue current: one import shortly after startup, then one
 * every `refreshHours` after the previous finished, so runs never overlap.
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

  const run = async (): Promise<void> => {
    const kind = nextRunKind(store.lastCompletedFullRun(), now(), options.fullRefreshDays);
    try {
      await runCatalogIngest({
        store,
        client: createClient(controller.signal),
        languages: options.languages,
        kind,
        log,
        signal: controller.signal,
      });
    } catch (error: unknown) {
      if (!controller.signal.aborted) {
        log.error({ err: error }, 'catalog.scheduled_run_failed');
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
