import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CATALOG_REGIONS,
  collectionEntry,
  collectionEntryId,
  isCatalogLanguage,
  isCollectionQuantity,
  isCollectionTarget,
  isCollectionVariant,
  type CatalogLanguage,
  type CatalogRegion,
  type CollectionChange,
  type CollectionEntry,
  type CollectionTarget,
} from '@pokepaper/shared';
import { LocalUserDataRepository } from '../data/local-user-data-repository';
import { catalogKey } from '../data/storage-engine';
import { inDisplayOrder } from './catalog-language.service';
import { SyncService } from './sync.service';

/** An entry with a region, variant and language this build knows. */
export type ShownEntry = CollectionEntry & { region: CatalogRegion; language: CatalogLanguage };

function isShown(entry: CollectionEntry): entry is ShownEntry {
  return (
    (CATALOG_REGIONS as readonly string[]).includes(entry.region) &&
    isCollectionVariant(entry.variant) &&
    isCatalogLanguage(entry.language)
  );
}

/** A card's copies in one language, across variants. */
export interface LanguageQuantity {
  language: CatalogLanguage;
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
  private readonly _loaded = signal(false);
  /**
   * Whether the collection has been read from storage. Until then counts
   * show 0, so screens disable editing (a change would overwrite what's
   * stored with a count based on 0).
   */
  readonly loaded = this._loaded.asReadonly();

  /**
   * Entries this build can show: known regions, variants and languages.
   * Badges and progress count only these, so every counted copy has a stepper.
   */
  private readonly shown = computed(() => [...this.entries().values()].filter(isShown));
  /** Every entry this build can show (collection value counts them all). */
  readonly ownedEntries = this.shown;

  /** Copies of each card per language, keyed like the catalog (`catalogKey`). */
  private readonly cardLanguages = computed(() => {
    const cards = new Map<string, Map<CatalogLanguage, number>>();
    for (const entry of this.shown()) {
      const key = catalogKey(entry.region, entry.cardId);
      let languages = cards.get(key);
      if (!languages) {
        languages = new Map();
        cards.set(key, languages);
      }
      languages.set(entry.language, (languages.get(entry.language) ?? 0) + entry.quantity);
    }
    return cards;
  });

  /** Owned cards per set and language, keyed `region:setId:language`. */
  private readonly setCards = computed(() => {
    const cards = new Map<string, Set<string>>();
    for (const entry of this.shown()) {
      const key = languageKey(entry.region, entry.setId, entry.language);
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
    return this.cardTotalByKey(catalogKey(region, cardId), language);
  }

  /** `cardTotal` by the card's catalog key (`region:id`), as search rows have it. */
  cardTotalByKey(cardKey: string, language: CatalogLanguage): number {
    return this.cardLanguages().get(cardKey)?.get(language) ?? 0;
  }

  /**
   * All copies of a card, in every language and variant, by catalog key
   * (decks count any language: docs/decks.md → Owned vs. needed).
   */
  copiesOfCard(cardKey: string): number {
    let total = 0;
    for (const quantity of this.cardLanguages().get(cardKey)?.values() ?? []) {
      total += quantity;
    }
    return total;
  }

  /** A card's copies in every language but `language`, in display order. */
  otherLanguages(
    region: CatalogRegion,
    cardId: string,
    language: CatalogLanguage
  ): LanguageQuantity[] {
    const languages =
      this.cardLanguages().get(catalogKey(region, cardId)) ?? new Map<CatalogLanguage, number>();
    return inDisplayOrder([...languages.keys()].filter((other) => other !== language)).map(
      (other) => ({ language: other, quantity: languages.get(other) ?? 0 })
    );
  }

  /** How many of a set's cards the user owns in `language` (any variant). */
  ownedInSet(region: CatalogRegion, setId: string, language: CatalogLanguage): number {
    return this.setCards().get(languageKey(region, setId, language))?.size ?? 0;
  }

  /**
   * Sets the copies of `target`: shown at once, then saved locally (and
   * synced). If saving fails, the saved collection is shown again. Rejects
   * an invalid target or quantity without showing it.
   */
  setQuantity(target: CollectionTarget, quantity: number): Promise<void> {
    return this.setQuantities([{ target, quantity }]);
  }

  /**
   * `setQuantity` for several targets, saved together (all or none), e.g.
   * marking a whole set owned. Rejects the lot if any change is invalid.
   */
  async setQuantities(changes: readonly CollectionChange[]): Promise<void> {
    if (
      changes.some(
        ({ target, quantity }) => !isCollectionQuantity(quantity) || !isCollectionTarget(target)
      )
    ) {
      throw new RangeError('Invalid collection target or quantity');
    }
    // One change per entry (the last listed wins). Until loaded, every one is
    // saved (the counts shown may still be 0).
    const latest = [
      ...new Map(changes.map((change) => [collectionEntryId(change.target), change])).values(),
    ];
    const effective = this._loaded()
      ? latest.filter(
          ({ target, quantity }) =>
            (this.entries().get(collectionEntryId(target))?.quantity ?? 0) !== quantity
        )
      : latest;
    if (effective.length === 0) {
      return;
    }
    this.generation++;
    this.pending++;
    this.entries.update((current) => {
      const next = new Map(current);
      for (const { target, quantity } of effective) {
        const key = collectionEntryId(target);
        if (quantity > 0) {
          next.set(key, collectionEntry(target, quantity));
        } else {
          next.delete(key);
        }
      }
      return next;
    });
    const save = this.saves.then(() => this.repository.setCollectionQuantities(effective));
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
        this._loaded.set(true);
      }
    } catch (error: unknown) {
      console.error('collection.load_failed', error);
    }
  }
}

/**
 * Keys a card or set ID within a catalog and language. `region` and
 * `language` never contain `:` (`isCollectionEntry`), so keys can't collide.
 */
function languageKey(region: string, id: string, language: string): string {
  return `${region}:${id}:${language}`;
}
