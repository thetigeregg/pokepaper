import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { CatalogCardPrices, CatalogRegion } from '@pokepaper/shared';
import { catalogKey } from '../data/storage-engine';
import { StorageEngineFactory } from '../data/storage-engine.factory';
import {
  beforeReverseHolos,
  setReverseHolos,
  type SetReverseHolos,
} from '../utils/catalog-price.util';
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
  /** `setReverseHolos` by set (`region:setId`), kept until a sync stores or removes a set. */
  private readonly reverseHolos = new Map<string, Promise<SetReverseHolos>>();
  /** `setsBeforeReverseHolos`, kept until a sync stores or removes a set. */
  private earlySets: Promise<Set<string>> | null = null;

  constructor() {
    const sync = inject(CatalogSyncService);
    sync.pricesChanged$.pipe(takeUntilDestroyed()).subscribe(() => {
      this._version.update((version) => version + 1);
    });
    sync.changed$.pipe(takeUntilDestroyed()).subscribe(() => {
      this.reverseHolos.clear();
      this.earlySets = null;
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
   * What the set's cards tell about its reverse holos (`setReverseHolos`),
   * which decides whether its cards' reverse holo prices and steppers show.
   * Read from the set's stored cards once per set, and again after a sync
   * changes the sets. A failed read isn't kept, so the next one tries again.
   */
  setReverseHolos(region: CatalogRegion, setId: string): Promise<SetReverseHolos> {
    const key = catalogKey(region, setId);
    const kept = this.reverseHolos.get(key);
    if (kept) {
      return kept;
    }
    const read = this.readSetReverseHolos(region, setId);
    this.reverseHolos.set(key, read);
    read.catch(() => {
      if (this.reverseHolos.get(key) === read) {
        this.reverseHolos.delete(key);
      }
    });
    return read;
  }

  /**
   * The stored sets from before reverse holos (`beforeReverseHolos`), keyed
   * `region:setId`: their reverse holo copies are valued by the base finish
   * (`variantFigures`). Read once, and again after a sync changes the sets.
   * A failed read isn't kept, so the next one tries again.
   */
  setsBeforeReverseHolos(): Promise<Set<string>> {
    if (this.earlySets) {
      return this.earlySets;
    }
    const read = this.readSetsBeforeReverseHolos();
    this.earlySets = read;
    read.catch(() => {
      if (this.earlySets === read) {
        this.earlySets = null;
      }
    });
    return read;
  }

  private async readSetsBeforeReverseHolos(): Promise<Set<string>> {
    const sets = await this.storageEngineFactory.getEngine().listCatalogSets();
    return new Set(sets.filter(({ set }) => beforeReverseHolos(set)).map(({ key }) => key));
  }

  private async readSetReverseHolos(
    region: CatalogRegion,
    setId: string
  ): Promise<SetReverseHolos> {
    const cards = await this.storageEngineFactory.getEngine().listCatalogCards(region, setId);
    return setReverseHolos(cards);
  }
}
