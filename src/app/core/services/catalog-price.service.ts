import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { CatalogCardPrices, CatalogRegion } from '@pokepaper/shared';
import { StorageEngineFactory } from '../data/storage-engine.factory';
import { CatalogSyncService } from './catalog-sync.service';

/**
 * Cards' Cardmarket prices as stored on the device (docs/catalog.md →
 * Prices on the device). Read per card: screens reload when `version`
 * changes, which it does whenever a sync stores new prices.
 */
@Injectable({ providedIn: 'root' })
export class CatalogPriceService {
  private readonly storageEngineFactory = inject(StorageEngineFactory);
  private readonly _version = signal(0);
  /** Bumped whenever the stored prices change. */
  readonly version = this._version.asReadonly();

  constructor() {
    inject(CatalogSyncService)
      .pricesChanged$.pipe(takeUntilDestroyed())
      .subscribe(() => {
        this._version.update((version) => version + 1);
      });
  }

  /**
   * A card's prices, or undefined when Cardmarket doesn't price it (or none
   * are stored yet). Rejects, never throws, when storage isn't ready.
   */
  async prices(region: CatalogRegion, cardId: string): Promise<CatalogCardPrices | undefined> {
    return this.storageEngineFactory.getEngine().getCatalogCardPrices(region, cardId);
  }
}
