import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { vi, type Mock } from 'vitest';
import type { CatalogCard } from '@pokepaper/shared';
import { makeContractCard, makeContractPrices } from '../data/storage-engine.contract';
import { StorageEngineFactory } from '../data/storage-engine.factory';
import { CatalogPriceService } from './catalog-price.service';
import { CatalogSyncService } from './catalog-sync.service';

describe('CatalogPriceService', () => {
  const pricesChanged = new Subject<void>();
  const setsChanged = new Subject<void>();
  const engine = {
    getCatalogCardPrices: vi.fn(() => Promise.resolve(makeContractPrices(0.14))),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: StorageEngineFactory, useValue: { getEngine: () => engine } },
        {
          provide: CatalogSyncService,
          useValue: { pricesChanged$: pricesChanged, changed$: setsChanged },
        },
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

  describe('setFlagsReverseHolos', () => {
    /** A set's cards: plain commons, `flagged` of them flagged reverse holo. */
    const cards = (flagged: number, total: number) =>
      Array.from({ length: total }, (_, index) => {
        const card = makeContractCard('intl', 'xy10', `xy10-${String(index)}`, index);
        return { ...card, variants: { ...card.variants, reverse: index < flagged } };
      });
    let listCatalogCards: Mock<(region: string, setId: string) => Promise<CatalogCard[]>>;

    beforeEach(() => {
      listCatalogCards = vi.fn(() => Promise.resolve(cards(1, 3)));
      TestBed.overrideProvider(StorageEngineFactory, {
        useValue: { getEngine: () => ({ listCatalogCards }) },
      });
    });

    it('reads whether most of the set’s commons are flagged, once per set', async () => {
      const service = TestBed.inject(CatalogPriceService);

      expect(await service.setFlagsReverseHolos('intl', 'xy10')).toBe(false);
      expect(await service.setFlagsReverseHolos('intl', 'xy10')).toBe(false);
      expect(listCatalogCards).toHaveBeenCalledTimes(1);
      expect(listCatalogCards).toHaveBeenCalledWith('intl', 'xy10');

      listCatalogCards.mockResolvedValue(cards(2, 3));
      expect(await service.setFlagsReverseHolos('intl', 'sv01')).toBe(true);
      expect(listCatalogCards).toHaveBeenCalledTimes(2);
    });

    it('reads a set again after a sync changes the sets', async () => {
      const service = TestBed.inject(CatalogPriceService);
      expect(await service.setFlagsReverseHolos('intl', 'xy10')).toBe(false);

      listCatalogCards.mockResolvedValue(cards(3, 3));
      setsChanged.next();

      expect(await service.setFlagsReverseHolos('intl', 'xy10')).toBe(true);
      expect(listCatalogCards).toHaveBeenCalledTimes(2);
    });

    it('tries a failed read again', async () => {
      listCatalogCards.mockRejectedValueOnce(new Error('not initialized'));
      const service = TestBed.inject(CatalogPriceService);

      await expect(service.setFlagsReverseHolos('intl', 'xy10')).rejects.toThrow('not initialized');
      expect(await service.setFlagsReverseHolos('intl', 'xy10')).toBe(false);
      expect(listCatalogCards).toHaveBeenCalledTimes(2);
    });
  });

  it('bumps its version whenever a sync stores new prices', () => {
    const service = TestBed.inject(CatalogPriceService);
    expect(service.version()).toBe(0);

    pricesChanged.next();
    pricesChanged.next();

    expect(service.version()).toBe(2);
  });
});
