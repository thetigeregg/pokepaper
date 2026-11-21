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

  it('bumps its version whenever a sync stores new prices', () => {
    const service = TestBed.inject(CatalogPriceService);
    expect(service.version()).toBe(0);

    pricesChanged.next();
    pricesChanged.next();

    expect(service.version()).toBe(2);
  });
});
