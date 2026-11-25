import { CARDMARKET_PRODUCTS_URL } from './cardmarket-products.js';
import { openCatalogDatabase } from './db.js';
import { CARDMARKET_PRICE_GUIDE_URL } from './prices.js';
import { runCatalogIngest } from './ingest.js';
import { nextRunKind, pricesDue, startCatalogSchedule } from './schedule.js';
import { CatalogStore } from './store.js';
import {
  ecbXml,
  fakeCardmarket,
  fakeClient,
  fakeTcgdex,
  fixtureProductList,
  memoryCatalogStore,
  silentLogger,
} from './test-helpers.js';

const HOUR = 60 * 60 * 1000;

/** Cardmarket's guide, the ECB unreachable: schedule tests never touch the network. */
let outside = fakeCardmarket();
beforeEach(() => {
  outside = fakeCardmarket();
});

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
    expect(pricesDue(null, true, now, 24)).toBe(true);
    expect(pricesDue(new Date('2026-01-09T00:00:00Z'), true, now, 24)).toBe(true);
    expect(pricesDue(new Date('2026-01-09T00:00:01Z'), true, now, 24)).toBe(false);
  });

  it('is due whenever no price guide is stored', () => {
    expect(pricesDue(new Date('2026-01-09T23:00:00Z'), false, now, 24)).toBe(true);
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
      fetch: outside.fetch,
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
      fetch: outside.fetch,
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
      fetch: outside.fetch,
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
      fetch: outside.fetch,
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
      fetch: outside.fetch,
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
      fetch: outside.fetch,
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

  it('downloads Cardmarket’s product list before a price pass, which checks products by it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = memoryCatalogStore();
    const fake = fakeTcgdex();
    const products = fakeCardmarket(fixtureProductList());
    const urls: string[] = [];
    const schedule = startCatalogSchedule({
      store,
      fetch: (input, init) => {
        const url =
          input instanceof Request ? input.url : input instanceof URL ? input.href : input;
        urls.push(url);
        return url === CARDMARKET_PRODUCTS_URL
          ? products.fetch(input, init)
          : outside.fetch(input, init);
      },
      languages: ['en', 'fr'],
      refreshHours: 12,
      fullRefreshDays: 7,
      pricesRefreshHours: 24,
      log: silentLogger(),
      initialDelayMs: 0,
      createClient: (signal) => fakeClient(fake, signal),
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(urls.indexOf(CARDMARKET_PRODUCTS_URL)).toBeGreaterThanOrEqual(0);
    expect(urls.indexOf(CARDMARKET_PRODUCTS_URL)).toBeLessThan(
      urls.indexOf(CARDMARKET_PRICE_GUIDE_URL)
    );
    expect(store.getCardmarketProductsState()).toBeDefined();
    expect(store.getPriceGuideState()?.rejections).toBeDefined();

    await schedule.stop();
  });

  it('refreshes prices at the next run when no price guide is stored, however recent the last pass', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const db = openCatalogDatabase(':memory:');
    const store = new CatalogStore(db);
    const fake = fakeTcgdex();
    let clock = new Date('2026-01-10T00:00:00Z').getTime();
    const schedule = startCatalogSchedule({
      store,
      fetch: outside.fetch,
      languages: ['en', 'fr'],
      refreshHours: 12,
      fullRefreshDays: 7,
      pricesRefreshHours: 24,
      log: silentLogger(),
      initialDelayMs: 0,
      createClient: (signal) => fakeClient(fake, signal),
      now: () => new Date(clock),
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(store.listPriceRuns()).toHaveLength(1);
    // As catalog migration 0006 does, so the next pass downloads the guide whole.
    db.prepare("DELETE FROM catalog_meta WHERE key = 'price_guide'").run();

    clock += 12 * HOUR;
    await vi.advanceTimersByTimeAsync(12 * HOUR);
    expect(store.listPriceRuns()).toHaveLength(2);
    expect(store.getPriceGuideState()).toBeDefined();

    await schedule.stop();
  });

  it('refreshes exchange rates after every run, keeping them when the ECB fails', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = memoryCatalogStore();
    let day = 20;
    let reachable = true;
    const createClient = vi.fn((signal: AbortSignal) => fakeClient(fakeTcgdex(), signal));
    const fetchRates = vi.fn(() =>
      reachable
        ? Promise.resolve(new Response(ecbXml(`2026-11-${String(day)}`, 0.92)))
        : Promise.reject(new Error('offline'))
    );
    const schedule = startCatalogSchedule({
      store,
      fetch: (input, init) =>
        (input instanceof Request ? input.url : input.toString()).includes('ecb.europa.eu')
          ? fetchRates()
          : outside.fetch(input, init),
      languages: ['en'],
      refreshHours: 12,
      fullRefreshDays: 7,
      pricesRefreshHours: 24,
      log: silentLogger(),
      initialDelayMs: 0,
      createClient,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(store.getExchangeRates()).toEqual({ date: '2026-11-20', rates: { CHF: 0.92 } });
    // Before the import, so a new server has rates before its first import ends.
    expect(fetchRates.mock.invocationCallOrder[0]).toBeLessThan(
      createClient.mock.invocationCallOrder[0] ?? 0
    );

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
      fetch: outside.fetch,
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
      fetch: outside.fetch,
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
      fetch: outside.fetch,
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
