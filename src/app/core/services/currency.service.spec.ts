import { TestBed } from '@angular/core/testing';
import { DEFAULT_SETTINGS, type SyncEntityType, type UserSettings } from '@pokepaper/shared';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { LocalUserDataRepository } from '../data/local-user-data-repository';
import { StorageEngineFactory } from '../data/storage-engine.factory';
import { CatalogSyncService, EXCHANGE_RATES_KEY } from './catalog-sync.service';
import { CurrencyService, currencyName, formatMoney } from './currency.service';
import { SyncService } from './sync.service';

describe('formatMoney', () => {
  it.each([
    [0.14, 'EUR', '€0.14'],
    [1234.5, 'CHF', 'CHF\u00a01,234.50'],
    [17.4, 'JPY', '¥17'],
    [2, 'USD', '$2.00'],
  ])('formats %d %s', (amount, currency, expected) => {
    expect(formatMoney(amount, currency)).toBe(expected);
  });

  it('names currencies in English', () => {
    expect(currencyName('CHF')).toBe('Swiss Franc');
  });
});

describe('CurrencyService', () => {
  let settings: UserSettings;
  let storedRates: string | undefined;
  const ratesChanged = new Subject<void>();
  const dataChanged = new Subject<ReadonlySet<SyncEntityType>>();
  const repository = {
    getSettings: vi.fn(() => Promise.resolve(settings)),
    updateSettings: vi.fn((next: UserSettings) => {
      settings = next;
      return Promise.resolve();
    }),
  };
  const engine = {
    getSyncMeta: vi.fn((key: string) =>
      Promise.resolve(
        key === EXCHANGE_RATES_KEY && storedRates !== undefined
          ? { key, value: storedRates }
          : undefined
      )
    ),
  };

  async function create(): Promise<CurrencyService> {
    TestBed.configureTestingModule({
      providers: [
        { provide: LocalUserDataRepository, useValue: repository },
        { provide: SyncService, useValue: { dataChanged$: dataChanged } },
        { provide: StorageEngineFactory, useValue: { getEngine: () => engine } },
        { provide: CatalogSyncService, useValue: { ratesChanged$: ratesChanged } },
      ],
    });
    const service = TestBed.inject(CurrencyService);
    await new Promise((resolve) => setTimeout(resolve));
    return service;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    settings = { ...DEFAULT_SETTINGS };
    storedRates = JSON.stringify({ date: '2026-11-20', rates: { CHF: 0.9, JPY: 170 } });
  });

  it('shows euros until another currency is picked', async () => {
    const service = await create();

    expect(service.currency()).toBe('EUR');
    expect(service.format(2)).toBe('€2.00');
  });

  it('converts to the picked currency, synced through settings', async () => {
    const service = await create();

    await service.pick('CHF');

    expect(repository.updateSettings).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      currency: 'CHF',
    });
    expect(service.currency()).toBe('CHF');
    expect(service.format(2)).toBe('CHF\u00a01.80');
  });

  it('reads the picked currency from synced settings', async () => {
    settings = { ...DEFAULT_SETTINGS, currency: 'JPY' };
    const service = await create();

    expect(service.format(2)).toBe('¥340');
  });

  it('stays in euros without a rate for the picked currency', async () => {
    settings = { ...DEFAULT_SETTINGS, currency: 'CHF' };
    storedRates = undefined;
    const service = await create();

    expect(service.preferred()).toBe('CHF');
    expect(service.currency()).toBe('EUR');
    expect(service.format(2)).toBe('€2.00');
    expect(service.options().map((option) => option.code)).toEqual(['EUR', 'CHF']);
  });

  it('reloads the rates when new ones are stored', async () => {
    settings = { ...DEFAULT_SETTINGS, currency: 'CHF' };
    const service = await create();

    storedRates = JSON.stringify({ date: '2026-11-21', rates: { CHF: 1 } });
    ratesChanged.next();
    await new Promise((resolve) => setTimeout(resolve));

    expect(service.rates()?.date).toBe('2026-11-21');
    expect(service.format(2)).toBe('CHF\u00a02.00');
  });

  it('ignores stored rates that aren’t rates', async () => {
    storedRates = '{"date":"today"}';
    const service = await create();

    expect(service.rates()).toBeNull();
  });

  it('offers euros and every currency with a rate, by name', async () => {
    const service = await create();

    expect(service.options()).toEqual([
      { code: 'EUR', name: 'Euro' },
      { code: 'JPY', name: 'Japanese Yen' },
      { code: 'CHF', name: 'Swiss Franc' },
    ]);
  });

  it('ignores a pick that isn’t a currency, or is the current one', async () => {
    const service = await create();

    await service.pick('Swiss franc');
    await service.pick('EUR');

    expect(repository.updateSettings).not.toHaveBeenCalled();
  });
});
