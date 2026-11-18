import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  collectionEntryId,
  type CatalogLanguage,
  type CatalogRegion,
  type CollectionEntry,
  type CollectionTarget,
} from '@pokepaper/shared';
import { LocalUserDataRepository } from '../data/local-user-data-repository';
import { SyncService } from './sync.service';

/** A card's copies in one language, across variants. */
export interface LanguageQuantity {
  language: string;
  quantity: number;
}

/**
 * The user's collection (docs/collection.md), held in memory: even a large
 * collection is a few thousand small entries, so badges, set progress and
 * the Owned filter read it synchronously. Changes show at once and are saved
 * locally (and synced) in order; pulled changes reload it.
 */
@Injectable({ providedIn: 'root' })
export class CollectionService {
  private readonly repository = inject(LocalUserDataRepository);
  private readonly entries = signal<ReadonlyMap<string, CollectionEntry>>(new Map());
  /** Changes are saved one at a time, in the order they were made. */
  private saves: Promise<void> = Promise.resolve();
  /** Changes not yet saved: loads meanwhile are dropped (they'd show stale counts). */
  private pending = 0;
  /** Bumped by each change, so a load that started before it is dropped too. */
  private generation = 0;

  /** Copies of each card per language, keyed `region:cardId:language`. */
  private readonly cardTotals = computed(() => {
    const totals = new Map<string, number>();
    for (const entry of this.entries().values()) {
      const key = cardLanguageKey(entry.region, entry.cardId, entry.language);
      totals.set(key, (totals.get(key) ?? 0) + entry.quantity);
    }
    return totals;
  });

  /** Owned cards per set and language, keyed `region:setId:language`. */
  private readonly setCards = computed(() => {
    const cards = new Map<string, Set<string>>();
    for (const entry of this.entries().values()) {
      const key = `${entry.region}:${entry.setId}:${entry.language}`;
      let owned = cards.get(key);
      if (!owned) {
        owned = new Set();
        cards.set(key, owned);
      }
      owned.add(entry.cardId);
    }
    return cards;
  });

  constructor() {
    void this.load();
    inject(SyncService)
      .dataChanged$.pipe(takeUntilDestroyed())
      .subscribe((types) => {
        if (types.has('collectionEntry')) {
          void this.load();
        }
      });
  }

  /** Copies of one card in one variant and language. */
  quantity(target: CollectionTarget): number {
    return this.entries().get(collectionEntryId(target))?.quantity ?? 0;
  }

  /** Copies of a card in `language`, across variants. */
  cardTotal(region: CatalogRegion, cardId: string, language: CatalogLanguage): number {
    return this.cardTotals().get(cardLanguageKey(region, cardId, language)) ?? 0;
  }

  /** A card's copies in every language but `language`, in `languages` order. */
  otherLanguages(
    region: CatalogRegion,
    cardId: string,
    language: CatalogLanguage,
    languages: readonly CatalogLanguage[]
  ): LanguageQuantity[] {
    return languages
      .filter((other) => other !== language)
      .map((other) => ({ language: other, quantity: this.cardTotal(region, cardId, other) }))
      .filter((other) => other.quantity > 0);
  }

  /** How many of a set's cards the user owns in `language` (any variant). */
  ownedInSet(region: CatalogRegion, setId: string, language: CatalogLanguage): number {
    return this.setCards().get(`${region}:${setId}:${language}`)?.size ?? 0;
  }

  /**
   * Sets the copies of `target`: shown at once, then saved locally (and
   * synced). If saving fails, the saved collection is shown again.
   */
  async setQuantity(target: CollectionTarget, quantity: number): Promise<void> {
    const key = collectionEntryId(target);
    if ((this.entries().get(key)?.quantity ?? 0) === quantity) {
      return;
    }
    this.generation++;
    this.pending++;
    this.entries.update((current) => {
      const next = new Map(current);
      if (quantity > 0) {
        next.set(key, { ...target, quantity });
      } else {
        next.delete(key);
      }
      return next;
    });
    const save = this.saves.then(() => this.repository.setCollectionQuantity(target, quantity));
    this.saves = save.catch(() => undefined);
    try {
      await save;
    } catch (error: unknown) {
      console.error('collection.save_failed', error);
    } finally {
      this.pending--;
      if (this.pending === 0) {
        await this.load(); // What was actually saved (rolls back a failed change).
      }
    }
  }

  private async load(): Promise<void> {
    const generation = this.generation;
    try {
      const stored = await this.repository.listCollection();
      if (generation === this.generation && this.pending === 0) {
        this.entries.set(new Map(stored.map((entry) => [collectionEntryId(entry), entry])));
      }
    } catch (error: unknown) {
      console.error('collection.load_failed', error);
    }
  }
}

function cardLanguageKey(region: string, cardId: string, language: string): string {
  return `${region}:${cardId}:${language}`;
}
