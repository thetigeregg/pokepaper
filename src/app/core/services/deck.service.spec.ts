import { TestBed } from '@angular/core/testing';
import { MAX_DECK_SLOTS, type Deck, type SyncEntityType } from '@pokepaper/shared';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { LocalUserDataRepository } from '../data/local-user-data-repository';
import { DeckChangeDroppedError, DeckService } from './deck.service';
import { SyncService } from './sync.service';

function makeDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'deck-1',
    name: 'Charizard ex',
    format: 'standard',
    cards: [{ region: 'intl', cardId: 'sv03-125', count: 3 }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const charizard = { region: 'intl', cardId: 'sv03-125' };
const pidgeot = { region: 'intl', cardId: 'sv03-164' };

describe('DeckService', () => {
  let stored: Map<string, Deck>;
  const dataChanged = new Subject<ReadonlySet<SyncEntityType>>();
  const repository = {
    listDecks: vi.fn(() => Promise.resolve([...stored.values()])),
    saveDeck: vi.fn((deck: Deck) => {
      stored.set(deck.id, deck);
      return Promise.resolve();
    }),
    deleteDeck: vi.fn((id: string) => {
      stored.delete(id);
      return Promise.resolve();
    }),
  };

  function seed(...decks: Deck[]): void {
    for (const deck of decks) {
      stored.set(deck.id, deck);
    }
  }

  async function create(): Promise<DeckService> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: LocalUserDataRepository, useValue: repository },
        { provide: SyncService, useValue: { dataChanged$: dataChanged.asObservable() } },
      ],
    });
    const service = TestBed.inject(DeckService);
    await vi.waitFor(() => {
      expect(service.loaded()).toBe(true);
    });
    return service;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    stored = new Map();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads stored decks, most recently changed first, then by name', async () => {
    seed(
      makeDeck({ id: 'a', name: 'Older', updatedAt: '2026-01-01T00:00:00.000Z' }),
      makeDeck({ id: 'b', name: 'Newer', updatedAt: '2026-01-03T00:00:00.000Z' }),
      makeDeck({ id: 'c', name: 'Also older', updatedAt: '2026-01-01T00:00:00.000Z' })
    );
    const service = await create();

    expect(service.decks().map((deck) => deck.id)).toEqual(['b', 'c', 'a']);
    expect(service.deck('a')?.name).toBe('Older');
    expect(service.deck('missing')).toBeUndefined();
  });

  it('isn’t loaded until storage has been read, nor after a failed read', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    repository.listDecks.mockRejectedValueOnce(new Error('broken'));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: LocalUserDataRepository, useValue: repository },
        { provide: SyncService, useValue: { dataChanged$: dataChanged.asObservable() } },
      ],
    });
    const service = TestBed.inject(DeckService);
    expect(service.loaded()).toBe(false);

    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith('deck.load_failed', expect.any(Error));
    });
    expect(service.loaded()).toBe(false);
    error.mockRestore();
  });

  it('creates an empty deck with a trimmed name, shown at once and saved', async () => {
    const service = await create();
    // After create(): vi.waitFor advances fake clocks while it polls.
    vi.useFakeTimers({ now: new Date('2026-02-01T12:00:00.000Z'), toFake: ['Date'] });

    const created = await service.create('  Lugia VSTAR ', 'expanded');

    expect(created).toEqual({
      id: expect.any(String) as string,
      name: 'Lugia VSTAR',
      format: 'expanded',
      cards: [],
      createdAt: '2026-02-01T12:00:00.000Z',
      updatedAt: '2026-02-01T12:00:00.000Z',
    });
    expect(service.deck(created.id)).toEqual(created);
    expect(repository.saveDeck).toHaveBeenCalledWith(created);
  });

  it('rejects creating a deck with a blank name, showing and saving nothing', async () => {
    const service = await create();

    await expect(service.create('   ', 'standard')).rejects.toThrow(TypeError);

    expect(service.decks()).toEqual([]);
    expect(repository.saveDeck).not.toHaveBeenCalled();
  });

  it('renames a deck and changes its format, moving its updatedAt forward', async () => {
    seed(makeDeck());
    const service = await create();
    vi.useFakeTimers({ now: new Date('2026-02-01T12:00:00.000Z'), toFake: ['Date'] });

    await service.update('deck-1', { name: ' Zard ' });
    await service.update('deck-1', { format: 'unlimited' });

    expect(service.deck('deck-1')).toMatchObject({
      name: 'Zard',
      format: 'unlimited',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    // Both changes in the same millisecond still order.
    expect(repository.saveDeck.mock.calls.map(([deck]) => deck.updatedAt)).toEqual([
      '2026-02-01T12:00:00.000Z',
      '2026-02-01T12:00:00.001Z',
    ]);
  });

  it('keeps updatedAt moving forward when the clock is behind the last change', async () => {
    seed(makeDeck());
    const service = await create();
    vi.useFakeTimers({ now: new Date('2025-06-01T00:00:00.000Z'), toFake: ['Date'] });

    await service.update('deck-1', { name: 'Zard' });

    expect(service.deck('deck-1')?.updatedAt).toBe('2026-01-01T00:00:00.001Z');
  });

  it('adds a printing at the end, changes its count, and removes it at 0', async () => {
    seed(makeDeck());
    const service = await create();

    await service.setCardCount('deck-1', pidgeot, 2);
    expect(service.deck('deck-1')?.cards).toEqual([
      { ...charizard, count: 3 },
      { ...pidgeot, count: 2 },
    ]);

    await service.setCardCount('deck-1', charizard, 4);
    expect(service.deck('deck-1')?.cards).toEqual([
      { ...charizard, count: 4 },
      { ...pidgeot, count: 2 },
    ]);

    await service.setCardCount('deck-1', charizard, 0);
    expect(service.deck('deck-1')?.cards).toEqual([{ ...pidgeot, count: 2 }]);
    expect(stored.get('deck-1')?.cards).toEqual([{ ...pidgeot, count: 2 }]);
  });

  it('skips a count that changes nothing, including 0 for a missing printing', async () => {
    seed(makeDeck());
    const service = await create();

    await service.setCardCount('deck-1', charizard, 3);
    await service.setCardCount('deck-1', pidgeot, 0);

    expect(repository.saveDeck).not.toHaveBeenCalled();
  });

  it.each([
    ['a negative count', charizard, -1, RangeError],
    ['a fractional count', charizard, 1.5, RangeError],
    ['a count over the maximum', charizard, 100, RangeError],
    ['a region with a colon', { region: 'a:b', cardId: 'x' }, 1, TypeError],
    ['an empty card ID', { region: 'intl', cardId: '' }, 1, TypeError],
  ])('rejects %s without showing it', async (_label, card, count, errorType) => {
    seed(makeDeck());
    const service = await create();

    await expect(service.setCardCount('deck-1', card, count)).rejects.toThrow(errorType);

    expect(service.deck('deck-1')).toEqual(makeDeck());
    expect(repository.saveDeck).not.toHaveBeenCalled();
  });

  it('rejects changes to a deck it doesn’t know', async () => {
    const service = await create();

    // Rejections, never synchronous throws, so `.catch()` handles them.
    await expect(service.update('missing', { name: 'x' })).rejects.toThrow(RangeError);
    await expect(service.setCardCount('missing', charizard, 1)).rejects.toThrow(RangeError);
    await expect(service.remove('missing')).rejects.toThrow(RangeError);
  });

  it('removes a deck at once and deletes it', async () => {
    seed(makeDeck(), makeDeck({ id: 'deck-2' }));
    const service = await create();

    await service.remove('deck-1');

    expect(service.decks().map((deck) => deck.id)).toEqual(['deck-2']);
    // With its last save's updatedAt, so the delete wins over it on the server.
    expect(repository.deleteDeck).toHaveBeenCalledWith('deck-1', '2026-01-01T00:00:00.000Z');
  });

  it('saves rapid changes in order', async () => {
    seed(makeDeck());
    const service = await create();

    await Promise.all([
      service.setCardCount('deck-1', charizard, 4),
      service.setCardCount('deck-1', pidgeot, 1),
      service.update('deck-1', { name: 'Zard' }),
    ]);

    expect(repository.saveDeck.mock.calls.map(([deck]) => deck.cards.length)).toEqual([1, 2, 2]);
    expect(stored.get('deck-1')).toMatchObject({
      name: 'Zard',
      cards: [
        { ...charizard, count: 4 },
        { ...pidgeot, count: 1 },
      ],
    });
  });

  it('rejects adding a printing to a full deck, naming why', async () => {
    const cards = Array.from({ length: MAX_DECK_SLOTS }, (_, i) => ({
      region: 'intl',
      cardId: `c-${String(i)}`,
      count: 1,
    }));
    seed(makeDeck({ cards }));
    const service = await create();

    await expect(service.setCardCount('deck-1', pidgeot, 1)).rejects.toThrow(
      `A deck holds at most ${String(MAX_DECK_SLOTS)} different printings`
    );
    // Changing a printing already in it still works.
    await service.setCardCount('deck-1', { region: 'intl', cardId: 'c-0' }, 2);
    expect(service.deck('deck-1')?.cards[0]?.count).toBe(2);
  });

  it('drops changes queued behind a failed save, since they carry it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    seed(makeDeck());
    const service = await create();
    repository.saveDeck.mockRejectedValueOnce(new Error('disk full'));

    const first = service.setCardCount('deck-1', charizard, 4);
    const second = service.setCardCount('deck-1', pidgeot, 2);

    await expect(first).rejects.toThrow('disk full');
    await expect(second).rejects.toThrow(DeckChangeDroppedError);
    expect(repository.saveDeck).toHaveBeenCalledTimes(1);
    expect(stored.get('deck-1')).toEqual(makeDeck());
    expect(service.deck('deck-1')).toEqual(makeDeck());
    error.mockRestore();
  });

  it('saves a change made after a failed save, from the saved deck', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    seed(makeDeck());
    const service = await create();
    repository.saveDeck.mockRejectedValueOnce(new Error('disk full'));

    await expect(service.setCardCount('deck-1', charizard, 4)).rejects.toThrow('disk full');
    await service.setCardCount('deck-1', pidgeot, 2);

    expect(stored.get('deck-1')?.cards).toEqual([
      { ...charizard, count: 3 },
      { ...pidgeot, count: 2 },
    ]);
    error.mockRestore();
  });

  it('shows the saved decks again when saving fails, even if reloading fails too', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    seed(makeDeck({ id: 'deck-2', name: 'Other' }));
    seed(makeDeck());
    const service = await create();
    await service.update('deck-2', { name: 'Other, saved' });
    repository.saveDeck.mockRejectedValueOnce(new Error('disk full'));
    repository.listDecks.mockRejectedValueOnce(new Error('storage gone'));

    await expect(service.update('deck-1', { name: 'Zard' })).rejects.toThrow('disk full');

    expect(service.deck('deck-1')?.name).toBe('Charizard ex');
    // Changes saved before the failure stay.
    expect(service.deck('deck-2')?.name).toBe('Other, saved');
    expect(error).toHaveBeenCalledWith('deck.load_failed', expect.any(Error));
    error.mockRestore();
  });

  it('shows the saved decks again and rejects when saving fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    seed(makeDeck());
    const service = await create();
    repository.saveDeck.mockRejectedValueOnce(new Error('disk full'));

    const change = service.update('deck-1', { name: 'Zard' });
    expect(service.deck('deck-1')?.name).toBe('Zard');

    await expect(change).rejects.toThrow('disk full');
    expect(service.deck('deck-1')?.name).toBe('Charizard ex');
    expect(error).toHaveBeenCalledWith('deck.save_failed', expect.any(Error));
    error.mockRestore();
  });

  it('a failed create rejects and leaves no deck behind', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const service = await create();
    repository.saveDeck.mockRejectedValueOnce(new Error('disk full'));

    await expect(service.create('Zard', 'standard')).rejects.toThrow('disk full');

    expect(service.decks()).toEqual([]);
    error.mockRestore();
  });

  it('reloads when a sync changes decks, and ignores other types', async () => {
    const service = await create();
    seed(makeDeck());

    dataChanged.next(new Set(['collectionEntry']));
    await Promise.resolve();
    expect(service.decks()).toEqual([]);

    dataChanged.next(new Set(['deck']));
    await vi.waitFor(() => {
      expect(service.decks()).toEqual([makeDeck()]);
    });
  });

  it('drops a load that finishes after a change was made', async () => {
    seed(makeDeck());
    const service = await create();
    let finishLoad: (decks: Deck[]) => void = () => undefined;
    repository.listDecks.mockImplementationOnce(
      () =>
        new Promise<Deck[]>((resolve) => {
          finishLoad = resolve;
        })
    );

    dataChanged.next(new Set(['deck']));
    await service.update('deck-1', { name: 'Zard' });
    finishLoad([makeDeck()]);
    await Promise.resolve();

    expect(service.deck('deck-1')?.name).toBe('Zard');
  });
});
