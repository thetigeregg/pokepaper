import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { CatalogCardPrices, CatalogRegion } from '@pokepaper/shared';
import { catalogKey } from '../data/storage-engine';
import { StorageEngineFactory } from '../data/storage-engine.factory';
import { flagsReverseHolos } from '../utils/catalog-price.util';
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
  /** `flagsReverseHolos` by set (`region:setId`), kept until a sync stores or removes a set. */
  private readonly reverseHoloFlags = new Map<string, Promise<boolean>>();

  constructor() {
    const sync = inject(CatalogSyncService);
    sync.pricesChanged$.pipe(takeUntilDestroyed()).subscribe(() => {
      this._version.update((version) => version + 1);
    });
    sync.changed$.pipe(takeUntilDestroyed()).subscribe(() => {
      this.reverseHoloFlags.clear();
    });
  }

  /**
   * A card's prices, or undefined when Cardmarket doesn't price it (or none
   * are stored yet). Rejects, never throws, when storage isn't ready.
   */
  async prices(region: CatalogRegion, cardId: string): Promise<CatalogCardPrices | undefined> {
    return this.storageEngineFactory.getEngine().getCatalogCardPrices(region, cardId);
  }

  /** Many cards' prices by catalog key (`region:cardId`); cards without prices are absent. */
  async pricesByKey(keys: readonly string[]): Promise<Map<string, CatalogCardPrices>> {
    return this.storageEngineFactory.getEngine().getCatalogPricesByKey(keys);
  }

  /**
   * Whether TCGdex keeps the set's reverse holo flags (`flagsReverseHolos`),
   * which decides whether its cards' reverse holo prices show. Read from
   * the set's stored cards once per set, and again after a sync changes
   * the sets. A failed read isn't kept, so the next one tries again.
   */
  setFlagsReverseHolos(region: CatalogRegion, setId: string): Promise<boolean> {
    const key = catalogKey(region, setId);
    const kept = this.reverseHoloFlags.get(key);
    if (kept) {
      return kept;
    }
    const read = this.readReverseHoloFlags(region, setId);
    this.reverseHoloFlags.set(key, read);
    read.catch(() => {
      if (this.reverseHoloFlags.get(key) === read) {
        this.reverseHoloFlags.delete(key);
      }
    });
    return read;
  }

  private async readReverseHoloFlags(region: CatalogRegion, setId: string): Promise<boolean> {
    const cards = await this.storageEngineFactory.getEngine().listCatalogCards(region, setId);
    return flagsReverseHolos(cards);
  }
}
