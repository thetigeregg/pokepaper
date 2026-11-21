import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { makeContractPrices } from '../data/storage-engine.contract';
import { StorageEngineFactory } from '../data/storage-engine.factory';
import { CatalogPriceService } from './catalog-price.service';
import { CatalogSyncService } from './catalog-sync.service';

describe('CatalogPriceService', () => {
  const pricesChanged = new Subject<void>();
  const engine = {
    getCatalogCardPrices: vi.fn(() => Promise.resolve(makeContractPrices(0.14))),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: StorageEngineFactory, useValue: { getEngine: () => engine } },
        { provide: CatalogSyncService, useValue: { pricesChanged$: pricesChanged } },
      ],
    });
  });

  it('reads a card’s stored prices', async () => {
    const service = TestBed.inject(CatalogPriceService);

    expect((await service.prices('asia', 'SV2a-001'))?.base?.trend).toBe(0.14);
    expect(engine.getCatalogCardPrices).toHaveBeenCalledWith('asia', 'SV2a-001');
  });

  it('reads many cards’ prices at once', async () => {
    const prices = new Map([['intl:sv01-001', makeContractPrices(1)]]);
    const getCatalogPricesByKey = vi.fn(() => Promise.resolve(prices));
    TestBed.overrideProvider(StorageEngineFactory, {
      useValue: { getEngine: () => ({ getCatalogPricesByKey }) },
    });
    const service = TestBed.inject(CatalogPriceService);

    expect(await service.pricesByKey(['intl:sv01-001', 'intl:x'])).toBe(prices);
    expect(getCatalogPricesByKey).toHaveBeenCalledWith(['intl:sv01-001', 'intl:x']);
  });

  it('rejects instead of throwing when storage isn’t ready', async () => {
    TestBed.overrideProvider(StorageEngineFactory, {
      useValue: {
        getEngine: () => {
          throw new Error('not initialized');
        },
      },
    });
    const service = TestBed.inject(CatalogPriceService);

    await expect(service.prices('intl', 'sv01-001')).rejects.toThrow('not initialized');
  });

  it('bumps its version whenever a sync stores new prices', () => {
    const service = TestBed.inject(CatalogPriceService);
    expect(service.version()).toBe(0);

    pricesChanged.next();
    pricesChanged.next();

    expect(service.version()).toBe(2);
  });
});
