import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  MAX_DECK_CARD_COUNT,
  deckCardKey,
  type CatalogCard,
  type CatalogRegion,
} from '@pokepaper/shared';
import { debounceTime } from 'rxjs';
import { catalogKey, type StorageEngine } from '../data/storage-engine';
import { StorageEngineFactory } from '../data/storage-engine.factory';
import {
  checkDeck,
  englishName,
  isBasicEnergy,
  nameTotal,
  printingLegal,
  POCKET_SERIES,
  ruleName,
  rulesFingerprint,
  MAX_COPIES_PER_NAME,
  type CheckedCard,
  type CheckedFormat,
  type DeckCheck,
  type NameLimit,
} from '../../features/decks/deck-rules';
import { normalizeSearchText } from '../utils/search-text.util';
import { CatalogSyncService } from './catalog-sync.service';
import { DeckService } from './deck.service';

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
  private readonly storageEngineFactory = inject(StorageEngineFactory);

  /** Cards looked up so far, by deck slot key; a key looked up but absent isn't on this device. */
  private readonly cards = signal<ReadonlyMap<string, CheckedCard>>(new Map());
  private readonly looked = signal<ReadonlySet<string>>(new Set());
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
    const checks = new Map<string, DeckCheck>();
    for (const deck of this.decks.decks()) {
      if (deck.cards.every((slot) => looked.has(deckCardKey(slot)))) {
        checks.set(deck.id, checkDeck(deck, cards));
      }
    }
    return checks;
  });

  constructor() {
    effect(() => {
      const keys = this.decks.decks().flatMap((deck) => deck.cards.map(deckCardKey));
      untracked(() => void this.ensure(keys));
    });
    inject(CatalogSyncService)
      .changed$.pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => {
        this.reset();
      });
  }

  /** The deck's check, once all its cards have been looked up. */
  check(deckId: string): DeckCheck | undefined {
    return this.checks().get(deckId);
  }

  /**
   * How many copies of `card`'s name the deck may hold, and holds now: 4 per
   * name across printings, or `MAX_DECK_CARD_COUNT` per printing for basic
   * Energy. Waits for the deck's cards to be looked up.
   */
  async copyLimit(deckId: string, card: CatalogCard): Promise<NameLimit> {
    const deck = this.decks.deck(deckId);
    const slots = deck?.cards ?? [];
    const key = catalogKey(card.region, card.id);
    if (isBasicEnergy(card)) {
      const total = slots.find((slot) => deckCardKey(slot) === key)?.count ?? 0;
      return { name: ruleName(card), total, limit: MAX_DECK_CARD_COUNT };
    }
    await this.ensure(slots.map(deckCardKey));
    const name = ruleName(card);
    const total = deck ? nameTotal(deck, this.cards(), name) : 0;
    return { name, total, limit: MAX_COPIES_PER_NAME };
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
    const serie = await this.serieOf(card);
    if (card.region !== 'intl' || serie === POCKET_SERIES) {
      // Japan & Asia printings and TCG Pocket cards: warned about as such.
      return { card, serie, legal };
    }
    for (const format of CHECKED_FORMATS) {
      legal[format] = printingLegal(card, serie, format);
    }
    if (CHECKED_FORMATS.some((format) => !legal[format])) {
      for (const reprint of await this.reprintsOf(card)) {
        const reprintSerie = await this.serieOf(reprint);
        for (const format of CHECKED_FORMATS) {
          legal[format] ||= printingLegal(reprint, reprintSerie, format);
        }
      }
    }
    return { card, serie, legal };
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
      names.catch(() => this.names.delete(region));
      this.names.set(region, names);
    }
    return names;
  }

  private async serieOf(card: CatalogCard): Promise<string | null> {
    const key = catalogKey(card.region, card.setId);
    if (!this.series.has(key)) {
      const stored = await this.engine.getCatalogSet(card.region, card.setId);
      this.series.set(key, stored?.set.serieId ?? null);
    }
    return this.series.get(key) ?? null;
  }

  /** The catalog changed: look every card up again. */
  private reset(): void {
    this.generation++;
    this.series.clear();
    this.names.clear();
    this.pending.clear();
    this.looked.set(new Set());
    this.cards.set(new Map());
    void this.ensure(this.decks.decks().flatMap((deck) => deck.cards.map(deckCardKey)));
  }

  private get engine(): StorageEngine {
    return this.storageEngineFactory.getEngine();
  }
}
