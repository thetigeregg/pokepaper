import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  deck,
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

/** A deck's two lists of printings: the deck itself, and its Considering pile. */
export type DeckList = 'cards' | 'considering';

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

/**
 * Rejects adding a printing to a deck (or its Considering pile) that already
 * has `MAX_DECK_SLOTS` of them.
 */
export class DeckFullError extends RangeError {
  override readonly name = 'DeckFullError';

  constructor(list: DeckList = 'cards') {
    const holder = list === 'considering' ? 'The Considering pile' : 'A deck';
    super(`${holder} holds at most ${String(MAX_DECK_SLOTS)} different printings`);
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

  /**
   * Copies a deck under a new name: its cards, Considering pile, format and
   * cover, as a new deck that's then edited on its own. Shown at once, then
   * saved; resolves with the copy once saved.
   */
  async duplicate(id: string, name: string): Promise<Deck> {
    const now = new Date().toISOString();
    const copy: Deck = {
      ...deck(this.require(id)),
      id: crypto.randomUUID(),
      name: name.trim(),
      createdAt: now,
      updatedAt: now,
    };
    await this.save(copy);
    return copy;
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
   * Chooses the printing shown for the deck in the Decks list, or (null)
   * goes back to the default, its first Pokémon.
   */
  async setCover(id: string, cover: DeckCardRef | null): Promise<void> {
    const current = this.require(id);
    const key = (ref: DeckCardRef | undefined | null) => (ref ? deckCardKey(ref) : null);
    if (key(cover) === key(current.cover)) {
      return; // Unchanged: don't move the deck up the list or sync anything.
    }
    const { cover: _previous, ...rest } = current;
    await this.save({
      ...rest,
      ...(cover ? { cover: { region: cover.region, cardId: cover.cardId } } : {}),
      updatedAt: this.nextUpdatedAt(current),
    });
  }

  /**
   * Sets the copies of one printing in a deck (0 removes it). A new printing
   * is added at the end, so the deck keeps the order cards were added in.
   */
  async setCardCount(id: string, card: DeckCardRef, count: number): Promise<void> {
    await this.setCount(id, 'cards', card, count);
  }

  /** Sets the copies of one printing in the deck's Considering pile, like `setCardCount`. */
  async setConsideringCount(id: string, card: DeckCardRef, count: number): Promise<void> {
    await this.setCount(id, 'considering', card, count);
  }

  /**
   * Moves one copy of a printing between the deck and its Considering pile,
   * as one change. Rejects (changing nothing) if the list it comes from has
   * none.
   */
  async moveCopy(id: string, card: DeckCardRef, to: DeckList): Promise<void> {
    const ref = cardRef(card);
    const current = this.require(id);
    const from: DeckList = to === 'cards' ? 'considering' : 'cards';
    const source = current[from] ?? [];
    const key = deckCardKey(ref);
    const have = source.find((slot) => deckCardKey(slot) === key)?.count ?? 0;
    if (have === 0) {
      throw new RangeError('No copy to move');
    }
    const target = current[to] ?? [];
    const want = (target.find((slot) => deckCardKey(slot) === key)?.count ?? 0) + 1;
    if (!isDeckCardCount(want)) {
      throw new RangeError('Invalid deck card count');
    }
    await this.save(
      this.withLists(current, {
        [from]: withCount(source, ref, have - 1, from),
        [to]: withCount(target, ref, want, to),
      })
    );
  }

  private async setCount(
    id: string,
    list: DeckList,
    card: DeckCardRef,
    count: number
  ): Promise<void> {
    if (count !== 0 && !isDeckCardCount(count)) {
      throw new RangeError('Invalid deck card count');
    }
    const ref = cardRef(card);
    const current = this.require(id);
    const slots = current[list] ?? [];
    const key = deckCardKey(ref);
    if ((slots.find((other) => deckCardKey(other) === key)?.count ?? 0) === count) {
      return;
    }
    await this.save(this.withLists(current, { [list]: withCount(slots, ref, count, list) }));
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

  /** `current` with some lists replaced and a later `updatedAt`; an empty pile is left out. */
  private withLists(current: Deck, lists: Partial<Record<DeckList, DeckCard[]>>): Deck {
    const { considering: _pile, ...rest } = current;
    const cards = lists.cards ?? current.cards;
    const considering = lists.considering ?? current.considering ?? [];
    return {
      ...rest,
      cards,
      ...(considering.length > 0 ? { considering } : {}),
      updatedAt: this.nextUpdatedAt(current),
    };
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

/** A printing as a deck slot key's parts, checked. */
function cardRef(card: DeckCardRef): DeckCardRef {
  const ref = { region: card.region, cardId: card.cardId };
  if (!isDeckCard({ ...ref, count: 1 })) {
    throw new TypeError('Invalid deck card');
  }
  return ref;
}

/**
 * `slots` (one of the deck's lists) with `count` copies of `card` (0 removes
 * it); a new printing goes at the end. Rejects adding one past `MAX_DECK_SLOTS`.
 */
function withCount(
  slots: readonly DeckCard[],
  card: DeckCardRef,
  count: number,
  list: DeckList
): DeckCard[] {
  const key = deckCardKey(card);
  const slot: DeckCard = { region: card.region, cardId: card.cardId, count };
  if (count === 0) {
    return slots.filter((other) => deckCardKey(other) !== key);
  }
  if (slots.some((other) => deckCardKey(other) === key)) {
    return slots.map((other) => (deckCardKey(other) === key ? slot : other));
  }
  if (slots.length >= MAX_DECK_SLOTS) {
    throw new DeckFullError(list);
  }
  return [...slots, slot];
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
