import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  deckCardKey,
  isDeck,
  isDeckCard,
  isDeckCardCount,
  MAX_DECK_SLOTS,
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
 * Rejects a change that was queued behind one that failed to save: it was
 * built on the failed change (saves carry the whole deck), so saving it would
 * save the failed change too.
 */
export class DeckChangeDroppedError extends Error {
  override readonly name = 'DeckChangeDroppedError';

  constructor() {
    super('Not saved: an earlier deck change failed to save');
  }
}

/** Rejects adding a printing to a deck that already has `MAX_DECK_SLOTS` of them. */
export class DeckFullError extends RangeError {
  override readonly name = 'DeckFullError';

  constructor() {
    super(`A deck holds at most ${String(MAX_DECK_SLOTS)} different printings`);
  }
}

/**
 * The user's decks (docs/decks.md), held in memory: a few dozen decks of at
 * most a few hundred slots each. Changes show at once and are saved locally
 * (and synced) in order, each as the whole deck; pulled changes reload them.
 *
 * Every change returns a promise that rejects if it can't be made or saved.
 * When a save fails, the decks last saved are shown again, and changes queued
 * behind it are dropped (`DeckChangeDroppedError`).
 */
@Injectable({ providedIn: 'root' })
export class DeckService {
  private readonly repository = inject(LocalUserDataRepository);
  private readonly byId = signal<ReadonlyMap<string, Deck>>(new Map());
  /** The decks as last loaded or saved: what a failed save goes back to. */
  private saved: ReadonlyMap<string, Deck> = new Map();
  /** Changes are saved one at a time, in the order they were made. */
  private saves: Promise<void> = Promise.resolve();
  /** Bumped by each failed save; a change queued before it is dropped. */
  private failures = 0;
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
  async update(id: string, changes: DeckChanges): Promise<void> {
    const current = this.require(id);
    await this.save({
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
  async setCardCount(id: string, card: DeckCardRef, count: number): Promise<void> {
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
      return;
    }
    let cards: DeckCard[];
    if (count === 0) {
      cards = current.cards.filter((other) => deckCardKey(other) !== key);
    } else if (existing) {
      cards = current.cards.map((other) => (deckCardKey(other) === key ? slot : other));
    } else if (current.cards.length >= MAX_DECK_SLOTS) {
      throw new DeckFullError();
    } else {
      cards = [...current.cards, slot];
    }
    await this.save({ ...current, cards, updatedAt: this.nextUpdatedAt(current) });
  }

  /** Deletes a deck: hidden at once, then deleted. */
  async remove(id: string): Promise<void> {
    const current = this.require(id);
    await this.change(
      (decks) => decks.delete(id),
      () => this.repository.deleteDeck(id, current.updatedAt)
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
   * Applies `edit` to the decks shown, then runs `persist` after earlier
   * saves. If an earlier save failed meanwhile, this change is dropped. If
   * `persist` fails, the decks last saved are shown again. Either way the
   * change rejects, so a caller (e.g. one opening a deck it just created)
   * can react.
   */
  private async change(
    edit: (decks: Map<string, Deck>) => void,
    persist: () => Promise<void>
  ): Promise<void> {
    const failures = this.failures;
    this.generation++;
    this.pending++;
    this.byId.update((current) => apply(current, edit));
    const run = async (): Promise<void> => {
      if (this.failures !== failures) {
        throw new DeckChangeDroppedError();
      }
      try {
        await persist();
      } catch (error: unknown) {
        // Before the next queued save runs, so it sees the failure.
        this.failures++;
        this.byId.set(this.saved);
        throw error;
      }
      this.saved = apply(this.saved, edit);
    };
    const saving = this.saves.then(run);
    this.saves = saving.catch(() => undefined);
    try {
      await saving;
    } catch (error: unknown) {
      console.error('deck.save_failed', error);
      throw error;
    } finally {
      this.pending--;
      if (this.pending === 0) {
        await this.load(); // What storage holds now, including pulled changes.
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
        this.saved = new Map(stored.map((deck) => [deck.id, deck]));
        this.byId.set(this.saved);
        this._loaded.set(true);
      }
    } catch (error: unknown) {
      console.error('deck.load_failed', error);
    }
  }
}

/** A copy of `decks` with `edit` applied. */
function apply(
  decks: ReadonlyMap<string, Deck>,
  edit: (decks: Map<string, Deck>) => void
): ReadonlyMap<string, Deck> {
  const next = new Map(decks);
  edit(next);
  return next;
}
