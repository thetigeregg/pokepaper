import type { CollectionEntry, SyncChange } from '@pokepaper/shared';
import { vi } from 'vitest';
import { CollectionSyncApplier } from './collection-sync-applier';
import type { StorageEngine } from './storage-engine';

const entry: CollectionEntry = {
  region: 'intl',
  cardId: 'sv01-001',
  setId: 'sv01',
  variant: 'normal',
  language: 'en',
  quantity: 2,
};

function change(overrides: Partial<SyncChange>): SyncChange {
  return {
    entityType: 'collectionEntry',
    entityId: 'intl:sv01-001:normal:en',
    operation: 'upsert',
    payload: entry,
    serverTimestamp: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('CollectionSyncApplier', () => {
  function setUp() {
    const engine = {
      putCollectionEntry: vi.fn(() => Promise.resolve()),
      deleteCollectionEntry: vi.fn(() => Promise.resolve()),
    };
    return { engine, typed: engine as unknown as StorageEngine };
  }

  it('stores an upserted entry', async () => {
    const { engine, typed } = setUp();

    await new CollectionSyncApplier().apply(typed, change({}));

    expect(engine.putCollectionEntry).toHaveBeenCalledWith(entry);
  });

  it('deletes by entity ID', async () => {
    const { engine, typed } = setUp();

    await new CollectionSyncApplier().apply(typed, change({ operation: 'delete', payload: null }));

    expect(engine.deleteCollectionEntry).toHaveBeenCalledWith('intl:sv01-001:normal:en');
  });

  it('skips an invalid upsert instead of storing it', async () => {
    const { engine, typed } = setUp();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await new CollectionSyncApplier().apply(typed, change({ payload: { ...entry, quantity: 0 } }));

    expect(engine.putCollectionEntry).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
