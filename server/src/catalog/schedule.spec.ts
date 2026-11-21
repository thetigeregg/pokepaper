import { runCatalogIngest } from './ingest.js';
import { nextRunKind, pricesDue, startCatalogSchedule } from './schedule.js';
import type { CatalogStore } from './store.js';
import {
  ecbXml,
  fakeClient,
  fakeTcgdex,
  memoryCatalogStore,
  silentLogger,
} from './test-helpers.js';

const HOUR = 60 * 60 * 1000;

/** The ECB unreachable: schedule tests never touch the network. */
const ecbOffline = (): Promise<Response> => Promise.reject(new Error('offline'));

describe('nextRunKind', () => {
  const now = new Date('2026-01-10T00:00:00Z');

  it('is a full refresh when none completed or the last is too old', () => {
    expect(nextRunKind(null, now, 7)).toBe('full');
    expect(nextRunKind(new Date('2026-01-03T00:00:00Z'), now, 7)).toBe('full');
    expect(nextRunKind(new Date('2026-01-03T00:00:01Z'), now, 7)).toBe('light');
  });
});

describe('pricesDue', () => {
  const now = new Date('2026-01-10T00:00:00Z');

  it('is due when no pass completed or the last one started long enough ago', () => {
    expect(pricesDue(null, now, 24)).toBe(true);
    expect(pricesDue(new Date('2026-01-09T00:00:00Z'), now, 24)).toBe(true);
    expect(pricesDue(new Date('2026-01-09T00:00:01Z'), now, 24)).toBe(false);
  });
});

describe('startCatalogSchedule', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const runKinds = (store: CatalogStore): string[] =>
    store
      .listRuns()
      .reverse()
      .map((run) => run.kind);
  const lastStatus = (store: CatalogStore): string | undefined => store.listRuns(1)[0]?.status;

  it('runs a full import after the initial delay, then light passes every interval', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    const schedule = startCatalogSchedule({
      store,
      fetchRates: ecbOffline,
      languages: ['en', 'fr'],
      refreshHours: 24,
      fullRefreshDays: 7,
      pricesRefreshHours: 24,
      log: silentLogger(),
      initialDelayMs: 1000,
      createClient: (signal) => fakeClient(fake, signal),
    });

    expect(runKinds(store)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(runKinds(store)).toEqual(['full']);
    expect(store.listSetIds('intl').length).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(24 * HOUR);
    expect(runKinds(store)).toEqual(['full', 'light']);

    await schedule.stop();
    await vi.advanceTimersByTimeAsync(48 * HOUR);
    expect(runKinds(store)).toEqual(['full', 'light']);
  });

  it('marks runs interrupted by a crash as aborted on start', async () => {
    const store = memoryCatalogStore();
    store.startRun('full');

    const schedule = startCatalogSchedule({
      store,
      fetchRates: ecbOffline,
      languages: ['en'],
      refreshHours: 24,
      fullRefreshDays: 7,
      pricesRefreshHours: 24,
      log: silentLogger(),
      initialDelayMs: HOUR,
    });
    await schedule.stop();

    expect(lastStatus(store)).toBe('aborted');
  });

  it('aborts a running import on stop, and logs failures of other runs', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = memoryCatalogStore();
    const log = silentLogger();
    const fake = fakeTcgdex();
    // Requests hang until aborted, like a stalled TCGdex.
    fake.fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason as Error);
        });
      });

    const schedule = startCatalogSchedule({
      store,
      fetchRates: ecbOffline,
      languages: ['en'],
      refreshHours: 24,
      fullRefreshDays: 7,
      pricesRefreshHours: 24,
      log,
      initialDelayMs: 0,
      createClient: (signal) => fakeClient(fake, signal),
    });
    await vi.advanceTimersByTimeAsync(0);

    await schedule.stop();

    expect(lastStatus(store)).toBe('aborted');
    expect(log.errors).toEqual([]);
  });

  it('logs a database error before the run starts instead of crashing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = memoryCatalogStore();
    const log = silentLogger();
    vi.spyOn(store, 'lastCompletedFullRun').mockImplementationOnce(() => {
      throw new Error('SQLITE_IOERR');
    });

    const schedule = startCatalogSchedule({
      store,
      fetchRates: ecbOffline,
      languages: ['en'],
      refreshHours: 1,
      fullRefreshDays: 7,
      pricesRefreshHours: 24,
      log,
      initialDelayMs: 0,
      createClient: (signal) => fakeClient(fakeTcgdex(), signal),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(log.errors).toEqual(['catalog.scheduled_run_failed']);

    await vi.advanceTimersByTimeAsync(HOUR);
    expect(runKinds(store)).toEqual(['full']);

    await schedule.stop();
  });

  it('logs a failed run and tries again at the next interval', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = memoryCatalogStore();
    const log = silentLogger();
    const replaceSeries = vi.spyOn(store, 'replaceSeries').mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    const schedule = startCatalogSchedule({
      store,
      fetchRates: ecbOffline,
      languages: ['en'],
      refreshHours: 1,
      fullRefreshDays: 7,
      pricesRefreshHours: 24,
      log,
      initialDelayMs: 0,
      createClient: (signal) => fakeClient(fakeTcgdex(), signal),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(log.errors).toEqual(['catalog.ingest_failed', 'catalog.scheduled_run_failed']);

    await vi.advanceTimersByTimeAsync(HOUR);
    expect(replaceSeries).toHaveBeenCalledTimes(2);
    expect(store.lastCompletedFullRun()).not.toBeNull();

    await schedule.stop();
  });

  it('refreshes prices after an import whenever they are due', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    let clock = new Date('2026-01-10T00:00:00Z').getTime();
    const schedule = startCatalogSchedule({
      store,
      fetchRates: ecbOffline,
      languages: ['en', 'fr'],
      refreshHours: 12,
      fullRefreshDays: 7,
      pricesRefreshHours: 24,
      log: silentLogger(),
      initialDelayMs: 0,
      createClient: (signal) => fakeClient(fake, signal),
      now: () => new Date(clock),
    });
    const priceRuns = (): number => store.listPriceRuns().length;

    await vi.advanceTimersByTimeAsync(0);
    expect(runKinds(store)).toEqual(['full']);
    expect(priceRuns()).toBe(1);
    expect(store.getCardPrices('intl', 'sv01-001')).toBeDefined();

    clock += 12 * HOUR;
    await vi.advanceTimersByTimeAsync(12 * HOUR);
    expect(runKinds(store)).toEqual(['full', 'light']);
    expect(priceRuns()).toBe(1);

    clock += 12 * HOUR;
    await vi.advanceTimersByTimeAsync(12 * HOUR);
    expect(priceRuns()).toBe(2);

    await schedule.stop();
  });

  it('refreshes exchange rates after every run, keeping them when the ECB fails', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = memoryCatalogStore();
    let day = 20;
    let reachable = true;
    const fetchRates = vi.fn(() =>
      reachable
        ? Promise.resolve(new Response(ecbXml(`2026-11-${String(day)}`, 0.92)))
        : Promise.reject(new Error('offline'))
    );
    const schedule = startCatalogSchedule({
      store,
      fetchRates,
      languages: ['en'],
      refreshHours: 12,
      fullRefreshDays: 7,
      pricesRefreshHours: 24,
      log: silentLogger(),
      initialDelayMs: 0,
      createClient: (signal) => fakeClient(fakeTcgdex(), signal),
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(store.getExchangeRates()).toEqual({ date: '2026-11-20', rates: { CHF: 0.92 } });

    day = 21;
    reachable = false;
    await vi.advanceTimersByTimeAsync(12 * HOUR);
    expect(fetchRates).toHaveBeenCalledTimes(2);
    expect(store.getExchangeRates()?.date).toBe('2026-11-20');

    reachable = true;
    await vi.advanceTimersByTimeAsync(12 * HOUR);
    expect(store.getExchangeRates()?.date).toBe('2026-11-21');

    await schedule.stop();
  });

  it('refreshes prices even when the import fails', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    await runCatalogIngest({
      store,
      client: fakeClient(fake),
      languages: ['en'],
      kind: 'full',
      log: silentLogger(),
    });
    const log = silentLogger();
    vi.spyOn(store, 'replaceSeries').mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    const schedule = startCatalogSchedule({
      store,
      fetchRates: ecbOffline,
      languages: ['en'],
      refreshHours: 24,
      fullRefreshDays: 7,
      pricesRefreshHours: 24,
      log,
      initialDelayMs: 0,
      createClient: (signal) => fakeClient(fake, signal),
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(log.errors).toEqual(['catalog.ingest_failed', 'catalog.scheduled_run_failed']);
    expect(store.listPriceRuns(1)[0]?.status).toBe('ok');
    expect(store.getCardPrices('intl', 'sv01-001')).toBeDefined();

    await schedule.stop();
  });

  it('logs a failed price pass and keeps the schedule going', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = memoryCatalogStore();
    const log = silentLogger();
    vi.spyOn(store, 'writeCardPrices').mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    const schedule = startCatalogSchedule({
      store,
      fetchRates: ecbOffline,
      languages: ['en'],
      refreshHours: 1,
      fullRefreshDays: 7,
      pricesRefreshHours: 1,
      log,
      initialDelayMs: 0,
      createClient: (signal) => fakeClient(fakeTcgdex(), signal),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(log.errors).toEqual(['catalog.prices_failed', 'catalog.scheduled_prices_failed']);

    await vi.advanceTimersByTimeAsync(HOUR);
    expect(runKinds(store)).toEqual(['full', 'light']);
    expect(store.listPriceRuns(1)[0]?.status).toBe('ok');

    await schedule.stop();
  });

  it('marks price passes interrupted by a crash as aborted on start', async () => {
    const store = memoryCatalogStore();
    store.startPriceRun();

    const schedule = startCatalogSchedule({
      store,
      fetchRates: ecbOffline,
      languages: ['en'],
      refreshHours: 24,
      fullRefreshDays: 7,
      pricesRefreshHours: 24,
      log: silentLogger(),
      initialDelayMs: HOUR,
    });
    await schedule.stop();

    expect(store.listPriceRuns(1)[0]?.status).toBe('aborted');
  });
});
