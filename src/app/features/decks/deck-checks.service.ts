import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { deckCardKey, type CatalogCard, type CatalogRegion, type Deck } from '@pokepaper/shared';
import { debounceTime } from 'rxjs';
import { catalogKey, type StorageEngine } from '../../core/data/storage-engine';
import { StorageEngineFactory } from '../../core/data/storage-engine.factory';
import {
  checkDeck,
  englishName,
  nameLimit,
  printingLegal,
  POCKET_SERIES,
  rulesFingerprint,
  type CheckedCard,
  type CheckedFormat,
  type DeckCheck,
  type NameLimit,
} from './deck-rules';
import { normalizeSearchText } from '../../core/utils/search-text.util';
import { CatalogSyncService } from '../../core/services/catalog-sync.service';
import { CollectionService } from '../../core/services/collection.service';
import { DeckService } from '../../core/services/deck.service';
import { ownedCoverage, type DeckOwned } from './deck-owned';

const CHECKED_FORMATS: readonly CheckedFormat[] = ['standard', 'expanded'];

/**
 * Each deck checked against its format (docs/decks.md → Format rules). Reads
 * the catalog cards of every deck's printings and works out their legality,
 * reprints included, then checks decks as they change. A deck's check
 * appears once all its cards have been looked up.
 */
@Injectable({ providedIn: 'root' })
export class DeckChecksService {
  private readonly decks = inject(DeckService);
  private readonly collection = inject(CollectionService);
  private readonly storageEngineFactory = inject(StorageEngineFactory);

  /** Cards looked up so far, by deck slot key; a key looked up but absent isn't on this device. */
  private readonly cards = signal<ReadonlyMap<string, CheckedCard>>(new Map());
  private readonly looked = signal<ReadonlySet<string>>(new Set());
  /**
   * The results from before the last catalog update, shown until the new
   * lookups land, so checks (and the + limits) don't vanish meanwhile.
   */
  private readonly previous = signal<{
    cards: ReadonlyMap<string, CheckedCard>;
    looked: ReadonlySet<string>;
  } | null>(null);
  /** Lookups in progress, by key, so `ensure` can wait for them. */
  private readonly pending = new Map<string, Promise<void>>();
  /** Set series by set key (`region:setId`), for Expanded's series rule. */
  private readonly series = new Map<string, string | null>();
  /** Printings by normalized name, per catalog, for the reprint rule (built when first needed). */
  private readonly names = new Map<CatalogRegion, Promise<ReadonlyMap<string, string[]>>>();
  /** Bumped when the catalog changes, so lookups from before are dropped. */
  private generation = 0;

  private readonly checks = computed(() => {
    const cards = this.cards();
    const looked = this.looked();
    const previous = this.previous();
    const checks = new Map<string, DeckCheck>();
    for (const deck of this.decks.decks()) {
      const keys = deck.cards.map(deckCardKey);
      if (keys.every((key) => looked.has(key))) {
        checks.set(deck.id, checkDeck(deck, cards));
      } else if (previous && keys.every((key) => previous.looked.has(key))) {
        checks.set(deck.id, checkDeck(deck, previous.cards));
      }
    }
    return checks;
  });

  constructor() {
    effect(() => {
      const keys = this.decks.decks().flatMap(allKeys);
      untracked(() => void this.ensure(keys));
    });
    inject(CatalogSyncService)
      .changed$.pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => {
        this.reset();
      });
  }

  /**
   * Owned vs. needed per deck (`ownedCoverage`), once the collection has
   * loaded and the deck's cards have been looked up. Follows the collection.
   */
  private readonly owned = computed(() => {
    if (!this.collection.loaded()) {
      return new Map<string, DeckOwned>();
    }
    const copies = (key: string) => this.collection.copiesOfCard(key);
    const cards = this.cards();
    const looked = this.looked();
    const previous = this.previous();
    const owned = new Map<string, DeckOwned>();
    for (const deck of this.decks.decks()) {
      const keys = allKeys(deck); // The pile's too: it's covered from what the deck leaves.
      if (keys.every((key) => looked.has(key))) {
        owned.set(deck.id, ownedCoverage(deck, cards, copies));
      } else if (previous && keys.every((key) => previous.looked.has(key))) {
        owned.set(deck.id, ownedCoverage(deck, previous.cards, copies));
      }
    }
    return owned;
  });

  /**
   * Each deck's cover: its chosen printing while it's still in the deck (and
   * on this device), else its first Pokémon (in deck order), from the cards
   * looked up so far. A chosen printing still being looked up shows nothing
   * yet, rather than the first Pokémon for a moment.
   */
  private readonly covers = computed(() => {
    const cards = this.cards();
    const looked = this.looked();
    const previous = this.previous();
    const card = (key: string) => (cards.get(key) ?? previous?.cards.get(key))?.card;
    const isLooked = (key: string) => looked.has(key) || (previous?.looked.has(key) ?? false);
    const covers = new Map<string, CatalogCard>();
    for (const deck of this.decks.decks()) {
      const keys = deck.cards.map(deckCardKey);
      const chosen = deck.cover ? deckCardKey(deck.cover) : null;
      if (chosen && keys.includes(chosen) && !isLooked(chosen)) {
        continue;
      }
      const cover =
        (chosen && keys.includes(chosen) ? card(chosen) : undefined) ??
        keys.map(card).find((entry) => entry?.category === 'Pokemon');
      if (cover) {
        covers.set(deck.id, cover);
      }
    }
    return covers;
  });

  /** The card shown for the deck in the Decks list, if any. */
  coverOf(deckId: string): CatalogCard | undefined {
    return this.covers().get(deckId);
  }

  /** What the collection covers of the deck, once known. */
  ownedOf(deckId: string): DeckOwned | undefined {
    return this.owned().get(deckId);
  }

  /** The deck's check, once all its cards have been looked up. */
  check(deckId: string): DeckCheck | undefined {
    return this.checks().get(deckId);
  }

  /**
   * How many copies of `card` the deck may hold, and holds now (`nameLimit`).
   * Reads the deck's cards from the catalog itself: names are all it needs,
   * so it doesn't wait for legality (reprint searches) or catalog updates.
   */
  async copyLimit(deckId: string, card: CatalogCard): Promise<NameLimit> {
    const deck = this.decks.deck(deckId) ?? { cards: [] };
    const found = await this.engine.getCatalogCardsByKey(deck.cards.map(deckCardKey));
    return nameLimit(
      deck,
      new Map(found.map((entry) => [catalogKey(entry.region, entry.id), entry])),
      card
    );
  }

  /** Looks up the cards of `keys` not looked up yet; resolves when all are. */
  private ensure(keys: readonly string[]): Promise<void> {
    const looked = this.looked();
    const wanted = [...new Set(keys)].filter((key) => !looked.has(key));
    const waits = wanted.flatMap((key) => this.pending.get(key) ?? []);
    const fresh = wanted.filter((key) => !this.pending.has(key));
    if (fresh.length > 0) {
      const lookup = this.lookUp(fresh).finally(() => {
        for (const key of fresh) {
          if (this.pending.get(key) === lookup) {
            this.pending.delete(key);
          }
        }
      });
      for (const key of fresh) {
        this.pending.set(key, lookup);
      }
      waits.push(lookup);
    }
    return Promise.all(waits).then(() => undefined);
  }

  private async lookUp(keys: readonly string[]): Promise<void> {
    const generation = this.generation;
    try {
      const found = await this.engine.getCatalogCardsByKey(keys);
      const checked = await Promise.all(found.map((card) => this.checkCard(card)));
      if (generation !== this.generation) {
        return;
      }
      this.cards.update((cards) => {
        const next = new Map(cards);
        for (const entry of checked) {
          next.set(catalogKey(entry.card.region, entry.card.id), entry);
        }
        return next;
      });
      this.looked.update((looked) => new Set([...looked, ...keys]));
    } catch (error: unknown) {
      // Left unlooked: tried again when decks or the catalog next change.
      console.error('deck.check_failed', error);
    }
  }

  /** A card's legality in each checked format: its own printing, else any identical reprint. */
  private async checkCard(card: CatalogCard): Promise<CheckedCard> {
    const legal: Record<CheckedFormat, boolean> = { standard: false, expanded: false };
    const own = catalogKey(card.region, card.id);
    const serie = await this.serieOf(card);
    if (card.region !== 'intl' || serie === POCKET_SERIES) {
      // Japan & Asia printings and TCG Pocket cards: warned about as such.
      return { card, serie, printings: [own], legal };
    }
    for (const format of CHECKED_FORMATS) {
      legal[format] = printingLegal(card, serie, format);
    }
    const printings = [own];
    let reprints: CatalogCard[] = [];
    try {
      reprints = await this.reprintsOf(card);
    } catch (error: unknown) {
      // Without the reprint search, the card still checks by its own mark
      // and covers only its own printing.
      console.error('deck.reprints_failed', error);
    }
    for (const reprint of reprints) {
      const reprintSerie = await this.serieOf(reprint);
      if (reprintSerie === POCKET_SERIES) {
        continue; // Digital only: neither a legal printing nor a copy to play.
      }
      printings.push(catalogKey(reprint.region, reprint.id));
      for (const format of CHECKED_FORMATS) {
        legal[format] ||= printingLegal(reprint, reprintSerie, format);
      }
    }
    return { card, serie, printings, legal };
  }

  /** Other printings with the same English name and rules text (handbook §4.1.3). */
  private async reprintsOf(card: CatalogCard): Promise<CatalogCard[]> {
    const names = await this.namesOf(card.region);
    const own = catalogKey(card.region, card.id);
    const keys = (names.get(normalizeSearchText(englishName(card))) ?? []).filter(
      (key) => key !== own
    );
    if (keys.length === 0) {
      return [];
    }
    const fingerprint = rulesFingerprint(card);
    return (await this.engine.getCatalogCardsByKey(keys)).filter(
      (other) => rulesFingerprint(other) === fingerprint
    );
  }

  private namesOf(region: CatalogRegion): Promise<ReadonlyMap<string, string[]>> {
    let names = this.names.get(region);
    if (!names) {
      names = this.engine.listCatalogSearchRows(region).then((rows) => {
        const map = new Map<string, string[]>();
        for (const row of rows) {
          for (const name of row.names) {
            const keys = map.get(name);
            if (keys) {
              keys.push(row.key);
            } else {
              map.set(name, [row.key]);
            }
          }
        }
        return map;
      });
      const built = names;
      // Forget a failed build (only this one: a catalog update may have replaced it).
      built.catch(() => {
        if (this.names.get(region) === built) {
          this.names.delete(region);
        }
      });
      this.names.set(region, built);
    }
    return names;
  }

  private async serieOf(card: CatalogCard): Promise<string | null> {
    const key = catalogKey(card.region, card.setId);
    if (this.series.has(key)) {
      return this.series.get(key) ?? null;
    }
    const generation = this.generation;
    const stored = await this.engine.getCatalogSet(card.region, card.setId);
    const serie = stored?.set.serieId ?? null;
    if (generation === this.generation) {
      this.series.set(key, serie); // Not from before a catalog update.
    }
    return serie;
  }

  /** The catalog changed: look every card up again, showing the old results until then. */
  private reset(): void {
    this.generation++;
    this.series.clear();
    this.names.clear();
    this.pending.clear();
    if (this.looked().size > 0) {
      this.previous.set({ cards: this.cards(), looked: this.looked() });
    }
    this.looked.set(new Set());
    this.cards.set(new Map());
    const refresh = this.ensure(this.decks.decks().flatMap(allKeys));
    const generation = this.generation;
    void refresh.then(() => {
      if (generation === this.generation) {
        this.previous.set(null);
      }
    });
  }

  private get engine(): StorageEngine {
    return this.storageEngineFactory.getEngine();
  }
}

/** The printings in a deck and its Considering pile. */
function allKeys(deck: Deck): string[] {
  return [...deck.cards, ...(deck.considering ?? [])].map(deckCardKey);
}
