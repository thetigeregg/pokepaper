import type { Deck, SyncChange } from '@pokepaper/shared';
import { vi } from 'vitest';
import { DeckSyncApplier } from './deck-sync-applier';
import type { StorageEngine } from './storage-engine';

const saved: Deck = {
  id: 'deck-1',
  name: 'Charizard ex',
  format: 'standard',
  cards: [{ region: 'intl', cardId: 'sv03-125', count: 3 }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function change(overrides: Partial<SyncChange>): SyncChange {
  return {
    entityType: 'deck',
    entityId: 'deck-1',
    operation: 'upsert',
    payload: saved,
    serverTimestamp: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('DeckSyncApplier', () => {
  function setUp() {
    const engine = {
      putDeck: vi.fn(() => Promise.resolve()),
      deleteDeck: vi.fn(() => Promise.resolve()),
    };
    return { engine, typed: engine as unknown as StorageEngine };
  }

  it('stores an upserted deck', async () => {
    const { engine, typed } = setUp();

    await new DeckSyncApplier().apply(typed, change({}));

    expect(engine.putDeck).toHaveBeenCalledWith(saved);
  });

  it('deletes by entity ID', async () => {
    const { engine, typed } = setUp();

    await new DeckSyncApplier().apply(typed, change({ operation: 'delete', payload: null }));

    expect(engine.deleteDeck).toHaveBeenCalledWith('deck-1');
  });

  it('stores only deck fields of a pulled payload', async () => {
    const { engine, typed } = setUp();

    await new DeckSyncApplier().apply(typed, change({ payload: { ...saved, extra: 1 } }));

    expect(engine.putDeck).toHaveBeenCalledWith(saved);
  });

  it.each([
    ['an invalid payload', change({ payload: { ...saved, name: '' } })],
    ['a payload for another deck', change({ entityId: 'deck-2' })],
  ])('removes the local row instead of storing %s', async (_label, pulled) => {
    const { engine, typed } = setUp();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await new DeckSyncApplier().apply(typed, pulled);

    expect(engine.putDeck).not.toHaveBeenCalled();
    expect(engine.deleteDeck).toHaveBeenCalledWith(pulled.entityId);
    expect(error).toHaveBeenCalledWith('deck.unusable_pulled_deck', pulled.entityId);
    error.mockRestore();
  });
});
