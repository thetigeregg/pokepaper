import { nextRunKind, startCatalogSchedule } from './schedule.js';
import type { CatalogStore } from './store.js';
import { fakeClient, fakeTcgdex, memoryCatalogStore, silentLogger } from './test-helpers.js';

const HOUR = 60 * 60 * 1000;

describe('nextRunKind', () => {
  const now = new Date('2026-01-10T00:00:00Z');

  it('is a full refresh when none completed or the last is too old', () => {
    expect(nextRunKind(null, now, 7)).toBe('full');
    expect(nextRunKind(new Date('2026-01-03T00:00:00Z'), now, 7)).toBe('full');
    expect(nextRunKind(new Date('2026-01-03T00:00:01Z'), now, 7)).toBe('light');
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
      languages: ['en', 'fr'],
      refreshHours: 24,
      fullRefreshDays: 7,
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
      languages: ['en'],
      refreshHours: 24,
      fullRefreshDays: 7,
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
    let release: () => void = () => undefined;
    const fake = fakeTcgdex();
    const fetchFn = fake.fetch;
    fake.fetch = async (...args: Parameters<typeof fetch>) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return fetchFn(...args);
    };

    const schedule = startCatalogSchedule({
      store,
      languages: ['en'],
      refreshHours: 24,
      fullRefreshDays: 7,
      log,
      initialDelayMs: 0,
      createClient: (signal) => fakeClient(fake, signal),
    });
    await vi.advanceTimersByTimeAsync(0);

    const stopped = schedule.stop();
    release();
    await stopped;

    expect(lastStatus(store)).toBe('aborted');
    expect(log.errors).toEqual([]);
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
      languages: ['en'],
      refreshHours: 1,
      fullRefreshDays: 7,
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
});
