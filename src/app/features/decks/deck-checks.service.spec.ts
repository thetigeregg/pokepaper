import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CatalogCard, CatalogRegion, Deck } from '@pokepaper/shared';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { makeContractCard, makeContractPack } from '../../core/data/storage-engine.contract';
import { StorageEngineFactory } from '../../core/data/storage-engine.factory';
import type { CatalogSearchRow } from '../../core/data/storage-engine';
import { CatalogSyncService } from '../../core/services/catalog-sync.service';
import { CollectionService } from '../../core/services/collection.service';
import { DeckChecksService } from './deck-checks.service';
import { DeckService } from '../../core/services/deck.service';

/** A card's English text (the contract card always has it). */
function englishText(entry: CatalogCard): NonNullable<CatalogCard['text']['en']> {
  const text = entry.text.en;
  if (!text) {
    throw new Error(`No English text for ${entry.id}`);
  }
  return text;
}

function card(
  setId: string,
  id: string,
  name: string,
  overrides: Partial<CatalogCard> = {}
): CatalogCard {
  const base = makeContractCard('intl', setId, id, 0);
  return {
    ...base,
    regulationMark: 'H',
    ...overrides,
    text: { en: { ...englishText(base), name } },
  };
}
const item = (setId: string, id: string, name: string, mark: string | null) =>
  card(setId, id, name, {
    category: 'Trainer',
    trainerType: 'Item',
    stage: null,
    hp: null,
    attacks: [],
    weaknesses: [],
    retreat: null,
    regulationMark: mark,
  });

const pikachu = card('sv01', 'sv01-1', 'Pikachu');
const oldBall = item('sv01', 'sv01-196', 'Ultra Ball', 'G');
const newBall = item('me01', 'me01-131', 'Ultra Ball', 'I');
const oddBall = item('sv02', 'sv02-9', 'Rare Ball', 'G');
const energy = card('sve', 'sve-2', 'Fire Energy', {
  category: 'Energy',
  energyType: 'Normal',
  stage: null,
  regulationMark: null,
});
const pocketCandy = item('A3', 'A3-144', 'Rare Candy', null);

const SERIES: Record<string, string> = {
  sv01: 'sv',
  sv02: 'sv',
  me01: 'me',
  sve: 'sv',
  A3: 'tcgp',
};

describe('DeckChecksService', () => {
  const stored = new Map<string, CatalogCard>();
  const engine = {
    getCatalogCardsByKey: vi.fn((keys: readonly string[]) =>
      Promise.resolve(keys.flatMap((key) => stored.get(key) ?? []))
    ),
    getCatalogSet: vi.fn((region: CatalogRegion, setId: string) =>
      Promise.resolve(
        SERIES[setId]
          ? {
              key: `${region}:${setId}`,
              region,
              hash: 'h',
              set: { ...makeContractPack(region, setId, []).set, serieId: SERIES[setId] },
            }
          : undefined
      )
    ),
    listCatalogSearchRows: vi.fn((region: CatalogRegion) =>
      Promise.resolve(
        [...stored.values()]
          .filter((entry) => entry.region === region)
          .map((entry): CatalogSearchRow => ({
            key: `${entry.region}:${entry.id}`,
            region: entry.region,
            setKey: `${entry.region}:${entry.setId}`,
            sortIndex: 0,
            names: [englishText(entry).name.toLowerCase()],
            category: entry.category,
            subtype: entry.trainerType,
            rarity: entry.rarity,
            types: entry.types,
          }))
      )
    ),
  };
  const list = signal<Deck[]>([]);
  const decks = {
    decks: computed(() => list()),
    deck: (id: string) => list().find((deck) => deck.id === id),
  };
  const changed = new Subject<void>();
  /** Copies owned by catalog key, any language. */
  const owned = signal<Record<string, number>>({});
  const collection = {
    loaded: signal(true),
    copiesOfCard: (key: string) => owned()[key] ?? 0,
  };

  const deckOf = (id: string, slots: [CatalogCard, number][], format = 'standard'): Deck => ({
    id,
    name: id,
    format,
    cards: slots.map(([entry, count]) => ({ region: entry.region, cardId: entry.id, count })),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  function create(): DeckChecksService {
    TestBed.configureTestingModule({
      providers: [
        { provide: StorageEngineFactory, useValue: { getEngine: () => engine } },
        { provide: DeckService, useValue: decks },
        { provide: CatalogSyncService, useValue: { changed$: changed.asObservable() } },
        { provide: CollectionService, useValue: collection },
      ],
    });
    const service = TestBed.inject(DeckChecksService);
    TestBed.tick();
    return service;
  }

  const issueIds = (service: DeckChecksService, id: string) =>
    service.check(id)?.issues.map((issue) => issue.id);

  beforeEach(() => {
    vi.clearAllMocks();
    stored.clear();
    for (const entry of [pikachu, oldBall, newBall, oddBall, energy, pocketCandy]) {
      stored.set(`intl:${entry.id}`, entry);
    }
    list.set([]);
    owned.set({});
    collection.loaded.set(true);
  });

  it('checks a deck once its cards have been looked up', async () => {
    list.set([
      deckOf('a', [
        [pikachu, 4],
        [energy, 56],
      ]),
    ]);
    const service = create();
    expect(service.check('a')).toBeUndefined();

    await vi.waitFor(() => {
      expect(service.check('a')).toMatchObject({ format: 'standard', issues: [] });
    });
    // Identical printings are searched for every card (owned vs. needed), with one name index.
    expect(engine.listCatalogSearchRows).toHaveBeenCalledTimes(1);
  });

  it('counts an older printing as legal when an identical reprint is (the reprint rule)', async () => {
    list.set([
      deckOf('reprinted', [
        [pikachu, 4],
        [oldBall, 1],
        [energy, 55],
      ]),
      deckOf('not', [
        [pikachu, 4],
        [oddBall, 1],
        [energy, 55],
      ]),
    ]);
    const service = create();

    await vi.waitFor(() => {
      expect(issueIds(service, 'reprinted')).toEqual([]);
      expect(issueIds(service, 'not')).toEqual(['legal']);
    });
    expect(engine.listCatalogSearchRows).toHaveBeenCalledTimes(1); // Built once, kept.
  });

  it('never counts TCG Pocket cards as legal, nor their physical lookalikes as theirs', async () => {
    list.set([
      deckOf('a', [
        [pikachu, 4],
        [pocketCandy, 1],
        [energy, 55],
      ]),
    ]);
    const service = create();

    await vi.waitFor(() => {
      expect(issueIds(service, 'a')).toEqual(['pocket']);
    });
  });

  it('checks a card not on this device as unknown', async () => {
    const deck = deckOf('a', [
      [pikachu, 4],
      [energy, 55],
    ]);
    list.set([{ ...deck, cards: [...deck.cards, { region: 'intl', cardId: 'gone', count: 1 }] }]);
    const service = create();

    await vi.waitFor(() => {
      expect(issueIds(service, 'a')).toEqual(['unknown']);
    });
  });

  it('looks up only cards added since, as decks change', async () => {
    list.set([deckOf('a', [[pikachu, 4]])]);
    const service = create();
    await vi.waitFor(() => {
      expect(service.check('a')).toBeDefined();
    });

    list.set([
      deckOf('a', [
        [pikachu, 4],
        [energy, 56],
      ]),
    ]);
    TestBed.tick();
    await vi.waitFor(() => {
      expect(issueIds(service, 'a')).toEqual([]);
    });
    expect(engine.getCatalogCardsByKey).toHaveBeenLastCalledWith(['intl:sve-2']);
  });

  it('gives the copy limit by name across printings, or per printing for basic Energy', async () => {
    list.set([
      deckOf('a', [
        [oldBall, 3],
        [newBall, 1],
        [energy, 20],
      ]),
    ]);
    const service = create();

    await expect(service.copyLimit('a', newBall)).resolves.toEqual({
      name: 'Ultra Ball',
      total: 4,
      limit: 4,
    });
    await expect(service.copyLimit('a', pikachu)).resolves.toEqual({
      name: 'Pikachu',
      total: 0,
      limit: 4,
    });
    await expect(service.copyLimit('a', energy)).resolves.toEqual({
      name: 'Fire Energy',
      total: 20,
      limit: 99,
    });
    await expect(service.copyLimit('missing', pikachu)).resolves.toMatchObject({ total: 0 });
  });

  it('covers deck cards with owned copies of identical printings, following the collection', async () => {
    list.set([
      deckOf('a', [
        [oldBall, 4],
        [oddBall, 1],
      ]),
    ]);
    owned.set({ 'intl:me01-131': 3 });
    const service = create();

    await vi.waitFor(() => {
      expect(service.ownedOf('a')?.slots.get('intl:sv01-196')).toEqual({
        owned: 3,
        fromOther: 3,
        missing: 1,
      });
    });
    expect(service.ownedOf('a')?.missing).toBe(2); // 1 Ultra Ball, 1 Rare Ball.

    owned.set({ 'intl:me01-131': 3, 'intl:sv02-9': 1 });
    expect(service.ownedOf('a')?.missing).toBe(1);
  });

  it('knows nothing owned until the collection has loaded', async () => {
    collection.loaded.set(false);
    list.set([deckOf('a', [[pikachu, 1]])]);
    const service = create();
    await vi.waitFor(() => {
      expect(service.check('a')).toBeDefined();
    });

    expect(service.ownedOf('a')).toBeUndefined();
    collection.loaded.set(true);
    expect(service.ownedOf('a')).toEqual({
      slots: new Map([['intl:sv01-1', { owned: 0, fromOther: 0, missing: 1 }]]),
      missing: 1,
    });
  });

  it('gives the copy limit without waiting for legality (reprint searches)', async () => {
    engine.listCatalogSearchRows.mockReturnValueOnce(new Promise(() => undefined));
    list.set([deckOf('a', [[oldBall, 2]])]);
    const service = create();

    await expect(service.copyLimit('a', newBall)).resolves.toEqual({
      name: 'Ultra Ball',
      total: 2,
      limit: 4,
    });
    expect(service.check('a')).toBeUndefined(); // Still searching for reprints.
  });

  it('keeps showing checks while a catalog update looks the cards up again', async () => {
    list.set([
      deckOf('a', [
        [pikachu, 4],
        [oddBall, 1],
        [energy, 55],
      ]),
    ]);
    const service = create();
    await vi.waitFor(() => {
      expect(issueIds(service, 'a')).toEqual(['legal']);
    });
    let finish: (cards: CatalogCard[]) => void = () => undefined;
    engine.getCatalogCardsByKey.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );

    vi.useFakeTimers();
    changed.next();
    vi.advanceTimersByTime(300);
    vi.useRealTimers();
    await Promise.resolve();

    expect(issueIds(service, 'a')).toEqual(['legal']); // The previous results, meanwhile.
    finish([pikachu, energy]); // The ball is gone from the updated catalog.
    await vi.waitFor(() => {
      expect(issueIds(service, 'a')).toEqual(['unknown']);
    });
  });

  it('leaves a deck unchecked when lookups fail, and tries again when decks change', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    engine.getCatalogCardsByKey.mockRejectedValueOnce(new Error('broken'));
    list.set([
      deckOf('a', [
        [pikachu, 4],
        [energy, 56],
      ]),
    ]);
    const service = create();

    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith('deck.check_failed', expect.any(Error));
    });
    expect(service.check('a')).toBeUndefined();

    list.set([
      deckOf(
        'a',
        [
          [pikachu, 4],
          [energy, 56],
        ],
        'expanded'
      ),
    ]);
    TestBed.tick();
    await vi.waitFor(() => {
      expect(service.check('a')).toMatchObject({ format: 'expanded', issues: [] });
    });
    error.mockRestore();
  });

  it('looks every card up again when the catalog changes, dropping lookups from before', async () => {
    list.set([
      deckOf('a', [
        [pikachu, 4],
        [energy, 56],
      ]),
    ]);
    const service = create();
    await vi.waitFor(() => {
      expect(service.check('a')).toBeDefined();
    });
    let finishStale: (cards: CatalogCard[]) => void = () => undefined;
    engine.getCatalogCardsByKey.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishStale = resolve;
        })
    );
    // A lookup that starts before the catalog changes…
    list.set([
      deckOf('a', [
        [pikachu, 4],
        [energy, 55],
        [oddBall, 1],
      ]),
    ]);
    TestBed.tick();

    vi.useFakeTimers();
    changed.next();
    vi.advanceTimersByTime(300);
    vi.useRealTimers();

    // …is dropped; the fresh one decides.
    await vi.waitFor(() => {
      expect(issueIds(service, 'a')).toEqual(['legal']);
    });
    finishStale([]);
    await new Promise((resolve) => setTimeout(resolve));
    expect(issueIds(service, 'a')).toEqual(['legal']);
  });
});
