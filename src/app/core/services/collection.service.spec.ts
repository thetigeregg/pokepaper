import { TestBed } from '@angular/core/testing';
import {
  collectionEntry,
  collectionEntryId,
  type CollectionChange,
  type CollectionEntry,
  type CollectionTarget,
  type SyncEntityType,
} from '@pokepaper/shared';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { LocalUserDataRepository } from '../data/local-user-data-repository';
import { CollectionService } from './collection.service';
import { SyncService } from './sync.service';

function target(overrides: Partial<CollectionTarget> = {}): CollectionTarget {
  return {
    region: 'intl',
    cardId: 'sv01-001',
    setId: 'sv01',
    variant: 'normal',
    language: 'en',
    ...overrides,
  };
}

describe('CollectionService', () => {
  let stored: Map<string, CollectionEntry>;
  const dataChanged = new Subject<ReadonlySet<SyncEntityType>>();
  const repository = {
    listCollection: vi.fn(() => Promise.resolve([...stored.values()])),
    setCollectionQuantities: vi.fn((changes: readonly CollectionChange[]) => {
      for (const { target: what, quantity } of changes) {
        if (quantity > 0) {
          stored.set(collectionEntryId(what), collectionEntry(what, quantity));
        } else {
          stored.delete(collectionEntryId(what));
        }
      }
      return Promise.resolve();
    }),
  };

  function seed(...entries: CollectionEntry[]): void {
    for (const entry of entries) {
      stored.set(collectionEntryId(entry), entry);
    }
  }

  async function create(): Promise<CollectionService> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: LocalUserDataRepository, useValue: repository },
        { provide: SyncService, useValue: { dataChanged$: dataChanged.asObservable() } },
      ],
    });
    const service = TestBed.inject(CollectionService);
    await vi.waitFor(() => {
      expect(repository.listCollection).toHaveBeenCalled();
    });
    await Promise.resolve();
    return service;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    stored = new Map();
  });

  it('loads the stored collection', async () => {
    seed({ ...target({ variant: 'holo' }), quantity: 2 });
    const service = await create();

    await vi.waitFor(() => {
      expect(service.quantity(target({ variant: 'holo' }))).toBe(2);
    });
    expect(service.quantity(target())).toBe(0);
    expect(service.loaded()).toBe(true);
  });

  it('isn’t loaded until storage has been read, nor after a failed read', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    repository.listCollection.mockImplementationOnce(() => Promise.reject(new Error('locked')));

    const service = await create();
    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith('collection.load_failed', expect.any(Error));
    });

    expect(service.loaded()).toBe(false);
    error.mockRestore();
  });

  it('counts only regions, variants and languages this build knows, keeping the others stored', async () => {
    seed(
      { ...target(), quantity: 1 },
      { ...target({ variant: 'stamped' }), quantity: 5 },
      { ...target({ language: 'ko' }), quantity: 7 },
      { ...target({ region: 'eu' }), quantity: 9 }
    );
    const service = await create();

    await vi.waitFor(() => {
      expect(service.cardTotal('intl', 'sv01-001', 'en')).toBe(1);
    });
    expect(service.otherLanguages('intl', 'sv01-001', 'en')).toEqual([]);
    expect(service.ownedInSet('intl', 'sv01', 'en')).toBe(1);
    expect(service.quantity(target({ variant: 'stamped' }))).toBe(5);
  });

  it('totals a card per language across variants, keeping languages apart', async () => {
    seed(
      { ...target(), quantity: 1 },
      { ...target({ variant: 'reverse' }), quantity: 2 },
      { ...target({ language: 'de' }), quantity: 4 }
    );
    const service = await create();

    await vi.waitFor(() => {
      expect(service.cardTotal('intl', 'sv01-001', 'en')).toBe(3);
    });
    expect(service.cardTotal('intl', 'sv01-001', 'de')).toBe(4);
    expect(service.cardTotalByKey('intl:sv01-001', 'en')).toBe(3); // A search row's key.
    expect(service.cardTotal('intl', 'sv01-001', 'fr')).toBe(0);
    expect(service.cardTotal('asia', 'sv01-001', 'en')).toBe(0);
  });

  it('totals all of a card’s copies, across languages and variants', async () => {
    seed(
      { ...target(), quantity: 1 },
      { ...target({ variant: 'reverse' }), quantity: 2 },
      { ...target({ language: 'de' }), quantity: 4 }
    );
    const service = await create();

    await vi.waitFor(() => {
      expect(service.copiesOfCard('intl:sv01-001')).toBe(7);
    });
    expect(service.copiesOfCard('intl:sv01-002')).toBe(0);
  });

  it('lists copies in other languages, in display order', async () => {
    seed(
      { ...target(), quantity: 1 },
      { ...target({ language: 'de' }), quantity: 4 },
      { ...target({ language: 'fr', variant: 'holo' }), quantity: 1 }
    );
    const service = await create();

    await vi.waitFor(() => {
      expect(service.otherLanguages('intl', 'sv01-001', 'en')).toEqual([
        { language: 'de', quantity: 4 },
        { language: 'fr', quantity: 1 },
      ]);
    });
    expect(service.otherLanguages('intl', 'sv01-999', 'en')).toEqual([]);
  });

  it('counts distinct owned cards per set and language', async () => {
    seed(
      { ...target(), quantity: 1 },
      { ...target({ variant: 'reverse' }), quantity: 1 },
      { ...target({ cardId: 'sv01-002' }), quantity: 3 },
      { ...target({ cardId: 'sv01-003', language: 'de' }), quantity: 1 },
      { ...target({ cardId: 'sv02-001', setId: 'sv02' }), quantity: 1 }
    );
    const service = await create();

    await vi.waitFor(() => {
      expect(service.ownedInSet('intl', 'sv01', 'en')).toBe(2);
    });
    expect(service.ownedInSet('intl', 'sv01', 'de')).toBe(1);
    expect(service.ownedInSet('intl', 'sv02', 'en')).toBe(1);
    expect(service.ownedInSet('asia', 'sv01', 'en')).toBe(0);
  });

  it('shows a change at once and saves it', async () => {
    const service = await create();

    const saving = service.setQuantity(target(), 2);
    expect(service.quantity(target())).toBe(2);
    await saving;

    expect(repository.setCollectionQuantities).toHaveBeenCalledWith([
      { target: target(), quantity: 2 },
    ]);
    expect(service.quantity(target())).toBe(2);
    expect(service.ownedInSet('intl', 'sv01', 'en')).toBe(1);
  });

  it('removes an entry set to 0, and skips a change to the current quantity', async () => {
    seed({ ...target(), quantity: 1 });
    const service = await create();
    await vi.waitFor(() => {
      expect(service.quantity(target())).toBe(1);
    });

    await service.setQuantity(target(), 1);
    expect(repository.setCollectionQuantities).not.toHaveBeenCalled();

    await service.setQuantity(target(), 0);
    expect(service.quantity(target())).toBe(0);
    expect(service.ownedInSet('intl', 'sv01', 'en')).toBe(0);
    expect(stored.size).toBe(0);
  });

  it.each([
    ['an oversized quantity', target(), 1000],
    ['a negative quantity', target(), -1],
    ['an invalid target', target({ language: 'e:n' }), 1],
  ])('rejects %s without showing or saving it', async (_label, what, quantity) => {
    const service = await create();

    await expect(service.setQuantity(what, quantity)).rejects.toThrow(RangeError);

    expect(service.quantity(what)).toBe(0);
    expect(repository.setCollectionQuantities).not.toHaveBeenCalled();
  });

  it('saves a 0 made before the collection has loaded', async () => {
    seed({ ...target(), quantity: 2 });
    let finishLoad: (entries: CollectionEntry[]) => void = () => undefined;
    repository.listCollection.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLoad = resolve;
        })
    );
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: LocalUserDataRepository, useValue: repository },
        { provide: SyncService, useValue: { dataChanged$: dataChanged.asObservable() } },
      ],
    });
    const service = TestBed.inject(CollectionService);

    await service.setQuantity(target(), 0);
    finishLoad([{ ...target(), quantity: 2 }]);

    expect(repository.setCollectionQuantities).toHaveBeenCalledWith([
      { target: target(), quantity: 0 },
    ]);
    expect(stored.size).toBe(0);
    expect(service.quantity(target())).toBe(0);
  });

  it('saves several changes together, skipping those that change nothing', async () => {
    seed({ ...target(), quantity: 1 });
    const service = await create();
    await vi.waitFor(() => {
      expect(service.quantity(target())).toBe(1);
    });

    const saving = service.setQuantities([
      { target: target(), quantity: 1 }, // Already 1.
      { target: target({ cardId: 'sv01-002' }), quantity: 1 },
      { target: target({ cardId: 'sv01-003' }), quantity: 1 },
    ]);
    expect(service.ownedInSet('intl', 'sv01', 'en')).toBe(3); // Shown at once.
    await saving;

    expect(repository.setCollectionQuantities).toHaveBeenCalledTimes(1);
    expect(repository.setCollectionQuantities.mock.calls[0]?.[0]).toEqual([
      { target: target({ cardId: 'sv01-002' }), quantity: 1 },
      { target: target({ cardId: 'sv01-003' }), quantity: 1 },
    ]);
    expect(stored.size).toBe(3);
  });

  it('keeps the last of several changes to one target', async () => {
    const service = await create();

    await service.setQuantities([
      { target: target(), quantity: 2 },
      { target: target(), quantity: 5 },
    ]);

    expect(repository.setCollectionQuantities.mock.calls[0]?.[0]).toEqual([
      { target: target(), quantity: 5 },
    ]);
    expect(service.quantity(target())).toBe(5);
  });

  it('rejects all of several changes when one is invalid, showing none', async () => {
    const service = await create();

    await expect(
      service.setQuantities([
        { target: target(), quantity: 1 },
        { target: target({ cardId: 'sv01-002' }), quantity: -1 },
      ])
    ).rejects.toThrow(RangeError);

    expect(service.quantity(target())).toBe(0);
    expect(repository.setCollectionQuantities).not.toHaveBeenCalled();
  });

  it('saves rapid changes in order', async () => {
    const service = await create();

    await Promise.all([
      service.setQuantity(target(), 1),
      service.setQuantity(target(), 2),
      service.setQuantity(target(), 3),
    ]);

    expect(
      repository.setCollectionQuantities.mock.calls.map(([changes]) => changes[0]?.quantity)
    ).toEqual([1, 2, 3]);
    expect(service.quantity(target())).toBe(3);
  });

  it('shows the saved collection again when saving fails', async () => {
    const service = await create();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    repository.setCollectionQuantities.mockImplementationOnce(() =>
      Promise.reject(new Error('disk full'))
    );

    await service.setQuantity(target(), 5);

    expect(service.quantity(target())).toBe(0);
    expect(error).toHaveBeenCalledWith('collection.save_failed', expect.any(Error));
    error.mockRestore();
  });

  it('reloads when a sync changes the collection, and ignores other types', async () => {
    const service = await create();
    seed({ ...target({ language: 'de' }), quantity: 2 });

    dataChanged.next(new Set(['settings']));
    await Promise.resolve();
    expect(repository.listCollection).toHaveBeenCalledTimes(1);

    dataChanged.next(new Set(['collectionEntry']));
    await vi.waitFor(() => {
      expect(service.quantity(target({ language: 'de' }))).toBe(2);
    });
  });

  it('keeps what it shows when loading fails', async () => {
    const service = await create();
    await service.setQuantity(target(), 1);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    repository.listCollection.mockImplementationOnce(() => Promise.reject(new Error('locked')));

    dataChanged.next(new Set(['collectionEntry']));

    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith('collection.load_failed', expect.any(Error));
    });
    expect(service.quantity(target())).toBe(1);
    error.mockRestore();
  });

  it('drops a load that finishes after a change was made', async () => {
    let finishLoad: (entries: CollectionEntry[]) => void = () => undefined;
    const service = await create();
    repository.listCollection.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLoad = resolve;
        })
    );

    dataChanged.next(new Set(['collectionEntry'])); // Starts a slow load of the old state.
    await service.setQuantity(target(), 2);
    finishLoad([]);
    await Promise.resolve();

    expect(service.quantity(target())).toBe(2);
  });
});
