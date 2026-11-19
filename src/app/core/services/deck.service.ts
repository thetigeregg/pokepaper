import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  deckCardKey,
  isDeck,
  isDeckCard,
  isDeckCardCount,
  type Deck,
  type DeckCard,
  type DeckFormat,
} from '@pokepaper/shared';
import { LocalUserDataRepository } from '../data/local-user-data-repository';
import { SyncService } from './sync.service';

/** A printing in a deck: what `setCardCount` takes. */
export type DeckCardRef = Pick<DeckCard, 'region' | 'cardId'>;

/** What `update` can change. */
export interface DeckChanges {
  name?: string;
  format?: DeckFormat;
}

/**
 * The user's decks (docs/decks.md), held in memory: a few dozen decks of at
 * most a few hundred slots each. Changes show at once and are saved locally
 * (and synced) in order, each as the whole deck; pulled changes reload them.
 * A change whose save fails shows the saved decks again and rejects.
 */
@Injectable({ providedIn: 'root' })
export class DeckService {
  private readonly repository = inject(LocalUserDataRepository);
  private readonly byId = signal<ReadonlyMap<string, Deck>>(new Map());
  /** Changes are saved one at a time, in the order they were made. */
  private saves: Promise<void> = Promise.resolve();
  /** Changes not yet saved: loads meanwhile are dropped (they'd show stale decks). */
  private pending = 0;
  /** Bumped by each change, so a load that started before it is dropped too. */
  private generation = 0;
  private readonly _loaded = signal(false);
  /**
   * Whether decks have been read from storage. Until then there are none to
   * edit: changes to a deck reject, since it isn't known yet.
   */
  readonly loaded = this._loaded.asReadonly();

  /** Every deck, most recently changed first (then by name). */
  readonly decks = computed(() =>
    [...this.byId().values()].sort(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name)
    )
  );

  constructor() {
    void this.load();
    inject(SyncService)
      .dataChanged$.pipe(takeUntilDestroyed())
      .subscribe((types) => {
        if (types.has('deck')) {
          void this.load();
        }
      });
  }

  deck(id: string): Deck | undefined {
    return this.byId().get(id);
  }

  /** Creates an empty deck: shown at once, then saved. Resolves with it once saved. */
  async create(name: string, format: DeckFormat): Promise<Deck> {
    const now = new Date().toISOString();
    const created: Deck = {
      id: crypto.randomUUID(),
      name: name.trim(),
      format,
      cards: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.save(created);
    return created;
  }

  /** Renames a deck or changes its format. */
  update(id: string, changes: DeckChanges): Promise<void> {
    const current = this.require(id);
    return this.save({
      ...current,
      name: changes.name === undefined ? current.name : changes.name.trim(),
      format: changes.format ?? current.format,
      updatedAt: this.nextUpdatedAt(current),
    });
  }

  /**
   * Sets the copies of one printing in a deck (0 removes it). A new printing
   * is added at the end, so the deck keeps the order cards were added in.
   */
  setCardCount(id: string, card: DeckCardRef, count: number): Promise<void> {
    if (count !== 0 && !isDeckCardCount(count)) {
      throw new RangeError('Invalid deck card count');
    }
    const slot: DeckCard = { region: card.region, cardId: card.cardId, count };
    if (!isDeckCard({ ...slot, count: 1 })) {
      throw new TypeError('Invalid deck card');
    }
    const current = this.require(id);
    const key = deckCardKey(slot);
    const existing = current.cards.find((other) => deckCardKey(other) === key);
    if ((existing?.count ?? 0) === count) {
      return Promise.resolve();
    }
    let cards: DeckCard[];
    if (count === 0) {
      cards = current.cards.filter((other) => deckCardKey(other) !== key);
    } else if (existing) {
      cards = current.cards.map((other) => (deckCardKey(other) === key ? slot : other));
    } else {
      cards = [...current.cards, slot];
    }
    return this.save({ ...current, cards, updatedAt: this.nextUpdatedAt(current) });
  }

  /** Deletes a deck: hidden at once, then deleted. */
  async remove(id: string): Promise<void> {
    this.require(id);
    await this.change(
      (next) => next.delete(id),
      () => this.repository.deleteDeck(id)
    );
  }

  /** Shows `next` at once, then saves it. Rejects an invalid deck without showing it. */
  private async save(next: Deck): Promise<void> {
    if (!isDeck(next)) {
      throw new TypeError('Invalid deck');
    }
    await this.change(
      (decks) => decks.set(next.id, next),
      () => this.repository.saveDeck(next)
    );
  }

  /**
   * Applies `show` to the decks shown, then runs `persist` after earlier
   * saves. If it fails, the saved decks are shown again and the change
   * rejects, so a caller (e.g. one opening a deck it just created) can react.
   */
  private async change(
    show: (decks: Map<string, Deck>) => void,
    persist: () => Promise<void>
  ): Promise<void> {
    this.generation++;
    this.pending++;
    this.byId.update((current) => {
      const next = new Map(current);
      show(next);
      return next;
    });
    const saved = this.saves.then(persist);
    this.saves = saved.catch(() => undefined);
    try {
      await saved;
    } catch (error: unknown) {
      console.error('deck.save_failed', error);
      throw error;
    } finally {
      this.pending--;
      if (this.pending === 0) {
        await this.load(); // What was actually saved (rolls back a failed change).
      }
    }
  }

  private require(id: string): Deck {
    const found = this.byId().get(id);
    if (!found) {
      throw new RangeError(`Unknown deck "${id}"`);
    }
    return found;
  }

  /**
   * Now, or 1 ms after the deck's last change if the clock says otherwise,
   * so a deck's `updatedAt` only moves forward.
   */
  private nextUpdatedAt(current: Deck): string {
    const now = Date.now();
    const previous = Date.parse(current.updatedAt);
    return new Date(now > previous ? now : previous + 1).toISOString();
  }

  private async load(): Promise<void> {
    const generation = this.generation;
    try {
      const stored = await this.repository.listDecks();
      if (generation === this.generation && this.pending === 0) {
        this.byId.set(new Map(stored.map((saved) => [saved.id, saved])));
        this._loaded.set(true);
      }
    } catch (error: unknown) {
      console.error('deck.load_failed', error);
    }
  }
}
