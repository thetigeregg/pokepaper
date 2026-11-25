import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  CatalogCard,
  CatalogCardPrices,
  CatalogPricePack,
  CatalogRegion,
  CatalogSeries,
  CatalogSetPack,
  CollectionEntry,
  Deck,
  UserSettings,
} from '@pokepaper/shared';
import { DEFAULT_SETTINGS, SETTINGS_ENTITY_ID } from '@pokepaper/shared';
import { catalogKey, NestedTransactionScopeError } from './storage-engine';
import type { ImageCacheRecord, OutboxEntry, StorageEngine, SyncMetaEntry } from './storage-engine';

/**
 * Behavioral contract every StorageEngine implementation must satisfy. Each
 * engine's spec calls `describeStorageEngineContract` with a harness factory,
 * so web (Dexie) and native (SQLite) are held to identical semantics.
 */
export interface StorageEngineContractHarness {
  engine: StorageEngine;
  cleanup: () => Promise<void>;
}

export function makeContractSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

export function makeContractImageCacheRecord(
  overrides: Partial<ImageCacheRecord> = {}
): ImageCacheRecord {
  return {
    key: 'sv1-001',
    blob: undefined,
    filePath: null,
    size: 100,
    lastAccessedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeContractSyncMetaEntry(overrides: Partial<SyncMetaEntry> = {}): SyncMetaEntry {
  return { key: 'pullCursor', value: '1', ...overrides };
}

export function makeContractOutboxEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    opId: 'op-1',
    entityType: 'settings',
    entityId: SETTINGS_ENTITY_ID,
    operation: 'upsert',
    payload: { ...DEFAULT_SETTINGS },
    clientTimestamp: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    attemptCount: 0,
    lastError: null,
    ...overrides,
  };
}

export function makeContractDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'deck-1',
    name: 'Charizard ex',
    format: 'standard',
    cards: [
      { region: 'intl', cardId: 'sv03-125', count: 3 },
      { region: 'intl', cardId: 'sve-002', count: 9 },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeContractCollectionEntry(
  overrides: Partial<CollectionEntry> = {}
): CollectionEntry {
  return {
    region: 'intl',
    cardId: 'sv01-001',
    setId: 'sv01',
    variant: 'normal',
    language: 'en',
    quantity: 1,
    ...overrides,
  };
}

export function makeContractCard(
  region: CatalogRegion,
  setId: string,
  id: string,
  sortIndex: number
): CatalogCard {
  return {
    region,
    id,
    setId,
    localId: id.split('-').at(-1) ?? id,
    sortIndex,
    category: 'Pokemon',
    rarity: 'Common',
    hp: 60,
    types: ['Grass'],
    stage: 'Basic',
    suffix: null,
    trainerType: null,
    energyType: null,
    dexIds: [204],
    retreat: 2,
    regulationMark: 'G',
    illustrator: null,
    variants: { normal: true, reverse: true, holo: false, firstEdition: false, wPromo: false },
    legal: { standard: false, expanded: true },
    weaknesses: [{ type: 'Fire', value: '×2' }],
    resistances: [],
    attacks: [{ cost: ['Colorless'], damage: '10' }],
    text: {
      en: {
        name: id,
        description: null,
        effect: null,
        evolveFrom: null,
        attacks: [{ name: 'Tackle', effect: null }],
        abilities: [],
        image: `en/x/${setId}/${id}`,
      },
    },
  };
}

/** A set pack whose cards are given in reverse order, to prove engines sort by `sortIndex`. */
export function makeContractPack(
  region: CatalogRegion,
  setId: string,
  cardIds: string[],
  hash = `hash-${setId}`
): CatalogSetPack {
  return {
    hash,
    set: {
      region,
      id: setId,
      serieId: 'sv',
      releaseDate: '2023-03-31',
      cardCount: { total: cardIds.length, official: cardIds.length },
      abbreviation: null,
      names: { en: setId },
      logos: {},
      symbol: null,
      legal: { standard: false, expanded: true },
      languages: ['en'],
    },
    cards: cardIds.map((id, index) => makeContractCard(region, setId, id, index)).reverse(),
  };
}

export function makeContractPrices(trend: number): CatalogCardPrices {
  return {
    updated: '2026-11-21T05:47:42.306Z',
    base: { trend, avg7: trend, avg30: trend },
    reverseHolo: null,
  };
}

export function makeContractPricePack(
  region: CatalogRegion,
  prices: Record<string, number>,
  version = 1
): CatalogPricePack {
  return {
    region,
    version,
    currency: 'EUR',
    prices: Object.fromEntries(
      Object.entries(prices).map(([cardId, trend]) => [cardId, makeContractPrices(trend)])
    ),
  };
}

export function makeContractSeries(region: CatalogRegion, id: string): CatalogSeries {
  return { region, id, names: { en: id }, logos: {} };
}

export function describeStorageEngineContract(
  engineName: string,
  createHarness: () => Promise<StorageEngineContractHarness>
): void {
  describe(`StorageEngine contract: ${engineName}`, () => {
    let harness: StorageEngineContractHarness;
    let engine: StorageEngine;

    beforeEach(async () => {
      harness = await createHarness();
      engine = harness.engine;
      await engine.initialize();
    });

    afterEach(async () => {
      await harness.cleanup();
    });

    describe('settings', () => {
      it('returns undefined before any settings are stored', async () => {
        expect(await engine.getSettings()).toBeUndefined();
      });

      it('putSettings stores the singleton row and getSettings retrieves it', async () => {
        await engine.putSettings(makeContractSettings({ cardLanguage: 'ja' }));

        expect(await engine.getSettings()).toEqual(makeContractSettings({ cardLanguage: 'ja' }));
      });

      it('putSettings replaces the existing row rather than adding a second one', async () => {
        await engine.putSettings(makeContractSettings({ cardLanguage: 'ja' }));
        await engine.putSettings(makeContractSettings({ cardLanguage: 'fr' }));

        expect((await engine.getSettings())?.cardLanguage).toBe('fr');
      });
    });

    describe('image cache', () => {
      it('supports put, get, delete and clear', async () => {
        await engine.putImage(makeContractImageCacheRecord({ key: 'a', filePath: 'images/a' }));
        await engine.putImage(makeContractImageCacheRecord({ key: 'b', filePath: 'images/b' }));

        expect((await engine.getImage('a'))?.filePath).toBe('images/a');

        await engine.deleteImage('a');
        expect(await engine.getImage('a')).toBeUndefined();

        await engine.clearImageCache();
        expect(await engine.getImage('b')).toBeUndefined();
      });

      const image = (key: string, size: number, lastAccessedAt: string) =>
        makeContractImageCacheRecord({ key, size, lastAccessedAt, filePath: `files/${key}` });

      it('splits usage by whether a downloaded set pins the image', async () => {
        await engine.putImage(image('a', 100, '2026-01-01T00:00:00.000Z'));
        await engine.putImage(image('b', 250, '2026-01-02T00:00:00.000Z'));
        await engine.putImage(image('c', 50, '2026-01-03T00:00:00.000Z'));
        await engine.pinImages('intl:sv01', ['b', 'not-downloaded']);

        expect(await engine.imageCacheUsage()).toEqual({ pinnedBytes: 250, unpinnedBytes: 150 });
      });

      it('lists unpinned images least recently viewed first, honoring touches', async () => {
        await engine.putImage(image('a', 1, '2026-01-01T00:00:00.000Z'));
        await engine.putImage(image('b', 1, '2026-01-02T00:00:00.000Z'));
        await engine.putImage(image('c', 1, '2026-01-03T00:00:00.000Z'));
        await engine.putImage(image('d', 1, '2026-01-04T00:00:00.000Z'));
        await engine.pinImages('intl:sv01', ['b']);
        await engine.touchImage('a', '2026-01-05T00:00:00.000Z');

        expect((await engine.listEvictableImages(10)).map((ref) => ref.key)).toEqual([
          'c',
          'd',
          'a',
        ]);
        expect(await engine.listEvictableImages(1)).toEqual([
          { key: 'c', filePath: 'files/c', size: 1 },
        ]);
        expect((await engine.getImage('a'))?.lastAccessedAt).toBe('2026-01-05T00:00:00.000Z');
      });

      it('keeps an image pinned until every set pinning it is removed', async () => {
        await engine.putImage(image('shared', 10, '2026-01-01T00:00:00.000Z'));
        await engine.pinImages('intl:sv01', ['shared']);
        await engine.pinImages('intl:sv02', ['shared']);

        await engine.unpinSet('intl:sv01');
        expect(await engine.listEvictableImages(10)).toEqual([]);

        await engine.unpinSet('intl:sv02');
        expect((await engine.listEvictableImages(10)).map((ref) => ref.key)).toEqual(['shared']);
      });

      it('summarizes downloaded sets by the pinned images they have stored', async () => {
        await engine.putImage(image('a', 100, '2026-01-01T00:00:00.000Z'));
        await engine.putImage(image('b', 30, '2026-01-01T00:00:00.000Z'));
        await engine.pinImages('intl:sv01', ['a', 'b', 'missing']);
        await engine.pinImages('intl:sv01', ['a']); // Pinning twice is harmless.
        await engine.pinImages('asia:SV2a', ['b']);

        expect(await engine.listPinnedSets()).toEqual([
          { setKey: 'asia:SV2a', images: 1, bytes: 30 },
          { setKey: 'intl:sv01', images: 2, bytes: 130 },
        ]);
      });

      it('deletes only unpinned images, returning them', async () => {
        await engine.putImage(image('a', 1, '2026-01-01T00:00:00.000Z'));
        await engine.putImage(image('b', 1, '2026-01-01T00:00:00.000Z'));
        await engine.pinImages('intl:sv01', ['b']);

        expect(await engine.deleteUnpinnedImages()).toEqual([
          { key: 'a', filePath: 'files/a', size: 1 },
        ]);
        expect(await engine.getImage('a')).toBeUndefined();
        expect(await engine.getImage('b')).toBeDefined();
      });

      it('evicts only images that are still unpinned', async () => {
        await engine.putImage(image('a', 1, '2026-01-01T00:00:00.000Z'));
        await engine.putImage(image('b', 1, '2026-01-01T00:00:00.000Z'));
        // Listed as evictable, then pinned by a download before the delete.
        await engine.pinImages('intl:sv01', ['b']);

        expect(await engine.evictImages(['a', 'b', 'never-stored'])).toEqual([
          { key: 'a', filePath: 'files/a', size: 1 },
        ]);
        expect(await engine.getImage('a')).toBeUndefined();
        expect(await engine.getImage('b')).toBeDefined();
      });

      it('deletes several images at once, and clears pins with the cache', async () => {
        await engine.putImage(image('a', 1, '2026-01-01T00:00:00.000Z'));
        await engine.putImage(image('b', 1, '2026-01-01T00:00:00.000Z'));
        await engine.pinImages('intl:sv01', ['a']);

        await engine.deleteImages(['a', 'b', 'never-stored']);
        expect(await engine.imageCacheUsage()).toEqual({ pinnedBytes: 0, unpinnedBytes: 0 });

        await engine.putDownloadedSet({
          setKey: 'intl:sv01',
          languages: ['en'],
          downloadedAt: '2026-01-01T00:00:00.000Z',
        });
        await engine.clearImageCache();
        expect(await engine.listPinnedSets()).toEqual([]);
        expect(await engine.listDownloadedSets()).toEqual([]);
      });

      it('records a view without rewriting the rest of the image', async () => {
        await engine.putImage(image('a', 7, '2026-01-01T00:00:00.000Z'));

        await engine.touchImage('a', '2026-02-01T00:00:00.000Z');

        expect(await engine.getImage('a')).toMatchObject({
          size: 7,
          filePath: 'files/a',
          lastAccessedAt: '2026-02-01T00:00:00.000Z',
        });
      });
    });

    describe('downloaded sets', () => {
      it('records, replaces, lists and deletes downloaded sets', async () => {
        await engine.putDownloadedSet({
          setKey: 'intl:sv01',
          languages: ['en'],
          downloadedAt: '2026-01-01T00:00:00.000Z',
        });
        await engine.putDownloadedSet({
          setKey: 'intl:sv01',
          languages: ['en', 'de'],
          downloadedAt: '2026-01-02T00:00:00.000Z',
        });
        await engine.putDownloadedSet({
          setKey: 'asia:SV2a',
          languages: ['ja'],
          downloadedAt: '2026-01-02T00:00:00.000Z',
        });

        const listed = await engine.listDownloadedSets();
        expect(listed.map((record) => record.setKey).sort()).toEqual(['asia:SV2a', 'intl:sv01']);
        expect(listed.find((record) => record.setKey === 'intl:sv01')?.languages).toEqual([
          'en',
          'de',
        ]);

        await engine.deleteDownloadedSet('intl:sv01');
        expect((await engine.listDownloadedSets()).map((record) => record.setKey)).toEqual([
          'asia:SV2a',
        ]);
      });
    });

    describe('collection', () => {
      it('is empty before anything is collected', async () => {
        expect(await engine.listCollectionEntries()).toEqual([]);
      });

      it('keys entries by card, variant and language, replacing quantities', async () => {
        const english = makeContractCollectionEntry();
        const german = makeContractCollectionEntry({ language: 'de', quantity: 2 });
        const reverse = makeContractCollectionEntry({ variant: 'reverse' });

        await engine.putCollectionEntry(english);
        await engine.putCollectionEntry(german);
        await engine.putCollectionEntry(reverse);
        await engine.putCollectionEntry({ ...german, quantity: 4 });

        const listed = await engine.listCollectionEntries();
        expect(listed).toHaveLength(3);
        expect(listed).toEqual(
          expect.arrayContaining([english, reverse, { ...german, quantity: 4 }])
        );
      });

      it('deletes an entry by key, leaving the others', async () => {
        await engine.putCollectionEntry(makeContractCollectionEntry());
        await engine.putCollectionEntry(makeContractCollectionEntry({ language: 'de' }));

        await engine.deleteCollectionEntry('intl:sv01-001:normal:en');
        await engine.deleteCollectionEntry('intl:unknown:normal:en');

        expect(await engine.listCollectionEntries()).toEqual([
          makeContractCollectionEntry({ language: 'de' }),
        ]);
      });

      it('rolls an entry back with the outbox write it shared a transaction with', async () => {
        await expect(
          engine.runInTransaction(['collection', 'outbox'], async () => {
            await engine.putCollectionEntry(makeContractCollectionEntry());
            await engine.putOutboxEntry(makeContractOutboxEntry());
            throw new Error('boom');
          })
        ).rejects.toThrow('boom');

        expect(await engine.listCollectionEntries()).toEqual([]);
        expect(await engine.listOutboxOrderedByCreatedAt()).toEqual([]);
      });
    });

    describe('decks', () => {
      it('is empty before any deck is saved', async () => {
        expect(await engine.listDecks()).toEqual([]);
      });

      it('keys decks by ID, replacing a saved deck whole', async () => {
        const first = makeContractDeck();
        const second = makeContractDeck({ id: 'deck-2', name: 'Lugia VSTAR', cards: [] });
        const edited = makeContractDeck({
          name: 'Zard',
          format: 'expanded',
          cards: [{ region: 'intl', cardId: 'sv03-125', count: 4 }],
          considering: [{ region: 'intl', cardId: 'sv03-125', count: 1 }],
          updatedAt: '2026-01-02T00:00:00.000Z',
        });

        await engine.putDeck(first);
        await engine.putDeck(second);
        await engine.putDeck(edited);

        const listed = await engine.listDecks();
        expect(listed).toHaveLength(2);
        expect(listed).toEqual(expect.arrayContaining([edited, second]));
      });

      it('deletes a deck by ID, leaving the others', async () => {
        await engine.putDeck(makeContractDeck());
        await engine.putDeck(makeContractDeck({ id: 'deck-2' }));

        await engine.deleteDeck('deck-1');
        await engine.deleteDeck('unknown');

        expect(await engine.listDecks()).toEqual([makeContractDeck({ id: 'deck-2' })]);
      });

      it('rolls a deck back with the outbox write it shared a transaction with', async () => {
        await expect(
          engine.runInTransaction(['decks', 'outbox'], async () => {
            await engine.putDeck(makeContractDeck());
            await engine.putOutboxEntry(makeContractOutboxEntry());
            throw new Error('boom');
          })
        ).rejects.toThrow('boom');

        expect(await engine.listDecks()).toEqual([]);
        expect(await engine.listOutboxOrderedByCreatedAt()).toEqual([]);
      });
    });

    describe('syncMeta', () => {
      it('supports put and get, replacing an existing key', async () => {
        await engine.putSyncMeta(makeContractSyncMetaEntry({ value: '1' }));
        await engine.putSyncMeta(makeContractSyncMetaEntry({ value: '2' }));

        expect((await engine.getSyncMeta('pullCursor'))?.value).toBe('2');
        expect(await engine.getSyncMeta('missing')).toBeUndefined();
      });
    });

    describe('card catalog', () => {
      it('is empty before anything is downloaded', async () => {
        expect(await engine.listCatalogSeries()).toEqual([]);
        expect(await engine.listCatalogSets()).toEqual([]);
        expect(await engine.getCatalogSet('intl', 'sv01')).toBeUndefined();
        expect(await engine.listCatalogCards('intl', 'sv01')).toEqual([]);
        expect(await engine.getCatalogCard('intl', 'sv01-001')).toBeUndefined();
        expect(await engine.catalogStats()).toEqual({ sets: 0, cards: 0 });
      });

      it('replaces all series at once', async () => {
        await engine.replaceCatalogSeries([
          makeContractSeries('intl', 'sv'),
          makeContractSeries('intl', 'swsh'),
        ]);
        await engine.replaceCatalogSeries([
          makeContractSeries('intl', 'sv'),
          makeContractSeries('asia', 'SV'),
        ]);

        const keys = (await engine.listCatalogSeries()).map((s) => `${s.region}:${s.id}`).sort();
        expect(keys).toEqual(['asia:SV', 'intl:sv']);
      });

      it('keeps the last of duplicate series rather than failing', async () => {
        const renamed = { ...makeContractSeries('intl', 'sv'), names: { en: 'Renamed' } };

        await engine.replaceCatalogSeries([makeContractSeries('intl', 'sv'), renamed]);

        expect(await engine.listCatalogSeries()).toEqual([renamed]);
      });

      it('stores a set with its hash, and its cards in display order', async () => {
        const pack = makeContractPack('intl', 'sv01', ['sv01-001', 'sv01-002', 'sv01-003']);

        await engine.replaceCatalogSet(pack);

        expect(await engine.listCatalogSets()).toEqual([
          { key: 'intl:sv01', region: 'intl', hash: 'hash-sv01', set: pack.set },
        ]);
        expect((await engine.listCatalogCards('intl', 'sv01')).map((card) => card.id)).toEqual([
          'sv01-001',
          'sv01-002',
          'sv01-003',
        ]);
        expect(await engine.getCatalogCard('intl', 'sv01-002')).toEqual(
          makeContractCard('intl', 'sv01', 'sv01-002', 1)
        );
        expect(await engine.catalogStats()).toEqual({ sets: 1, cards: 3 });
      });

      it('replaces an earlier copy of a set, dropping cards no longer in it', async () => {
        await engine.replaceCatalogSet(makeContractPack('intl', 'sv01', ['sv01-001', 'sv01-002']));

        await engine.replaceCatalogSet(makeContractPack('intl', 'sv01', ['sv01-002'], 'hash-2'));

        expect((await engine.listCatalogSets())[0]?.hash).toBe('hash-2');
        expect((await engine.listCatalogCards('intl', 'sv01')).map((card) => card.id)).toEqual([
          'sv01-002',
        ]);
        expect(await engine.getCatalogCard('intl', 'sv01-001')).toBeUndefined();
      });

      it('keeps regions apart even when IDs repeat', async () => {
        await engine.replaceCatalogSet(makeContractPack('intl', 'neo1', ['neo1-1']));
        await engine.replaceCatalogSet(makeContractPack('asia', 'neo1', ['neo1-1', 'neo1-2']));

        expect((await engine.listCatalogSets('intl')).map((set) => set.key)).toEqual(['intl:neo1']);
        expect((await engine.listCatalogSets('asia')).map((set) => set.key)).toEqual(['asia:neo1']);
        expect((await engine.getCatalogSet('asia', 'neo1'))?.key).toBe('asia:neo1');
        expect((await engine.getCatalogSet('intl', 'neo1'))?.set.region).toBe('intl');
        expect(await engine.getCatalogSet('intl', 'NEO1')).toBeUndefined(); // Case-sensitive.
        expect(await engine.listCatalogCards('intl', 'neo1')).toHaveLength(1);
        expect(await engine.listCatalogCards('asia', 'neo1')).toHaveLength(2);
      });

      it('moves a card that changed sets', async () => {
        await engine.replaceCatalogSet(makeContractPack('intl', 'sv01', ['sv01-001']));
        const moved = makeContractPack('intl', 'svp', []);
        moved.cards = [{ ...makeContractCard('intl', 'svp', 'sv01-001', 0) }];

        await engine.replaceCatalogSet(moved);

        expect(await engine.listCatalogCards('intl', 'svp')).toHaveLength(1);
        expect(await engine.listCatalogCards('intl', 'sv01')).toEqual([]);
        expect(await engine.catalogStats()).toEqual({ sets: 2, cards: 1 });
      });

      it('deletes a set and only its cards', async () => {
        await engine.replaceCatalogSet(makeContractPack('intl', 'sv01', ['sv01-001']));
        await engine.replaceCatalogSet(makeContractPack('intl', 'sv02', ['sv02-001']));

        await engine.deleteCatalogSet('intl', 'sv01');

        expect((await engine.listCatalogSets()).map((set) => set.key)).toEqual(['intl:sv02']);
        expect(await engine.catalogStats()).toEqual({ sets: 1, cards: 1 });
      });

      it('rolls a set back with the transaction it joined', async () => {
        await expect(
          engine.runInTransaction(
            ['catalogSets', 'catalogCards', 'catalogCardSearch'],
            async () => {
              await engine.replaceCatalogSet(makeContractPack('intl', 'sv01', ['sv01-001']));
              throw new Error('boom');
            }
          )
        ).rejects.toThrow('boom');

        expect(await engine.catalogStats()).toEqual({ sets: 0, cards: 0 });
        expect(await engine.listCatalogSearchRows('intl')).toEqual([]);
      });

      it('gets cards by key in the order asked, skipping unknown keys', async () => {
        await engine.replaceCatalogSet(makeContractPack('intl', 'sv01', ['sv01-001', 'sv01-002']));
        await engine.replaceCatalogSet(makeContractPack('asia', 'sv01', ['sv01-001']));

        const cards = await engine.getCatalogCardsByKey([
          'intl:sv01-002',
          'intl:nope',
          'asia:sv01-001',
          'intl:sv01-001',
        ]);

        expect(cards.map((card) => `${card.region}:${card.id}`)).toEqual([
          'intl:sv01-002',
          'asia:sv01-001',
          'intl:sv01-001',
        ]);
        expect(await engine.getCatalogCardsByKey([])).toEqual([]);
      });
    });

    describe('card search rows', () => {
      function multilingualPack(): CatalogSetPack {
        const pack = makeContractPack('intl', 'sv01', ['sv01-001', 'sv01-002']);
        const [second, first] = pack.cards as [CatalogCard, CatalogCard];
        const english = first.text.en;
        if (!english) {
          throw new Error('The contract card has English text');
        }
        first.text = {
          en: { ...english, name: 'Pineco' },
          fr: { ...english, name: 'Pomdepik' },
          de: { ...english, name: 'Tannza' },
          it: { ...english, name: 'PINECO' }, // Same once normalized.
        };
        second.category = 'Trainer';
        second.trainerType = 'Supporter';
        second.rarity = null;
        second.types = [];
        second.text = { en: { ...english, name: "Professor's Research" } };
        return pack;
      }

      it('stores a search row for every card of a set', async () => {
        await engine.replaceCatalogSet(multilingualPack());

        const rows = (await engine.listCatalogSearchRows('intl')).sort((a, b) =>
          a.key.localeCompare(b.key)
        );
        expect(rows).toEqual([
          {
            key: 'intl:sv01-001',
            region: 'intl',
            setKey: 'intl:sv01',
            sortIndex: 0,
            names: ['pineco', 'pomdepik', 'tannza'],
            number: '001',
            category: 'Pokemon',
            subtype: null,
            rarity: 'Common',
            types: ['Grass'],
            illustrator: null,
          },
          {
            key: 'intl:sv01-002',
            region: 'intl',
            setKey: 'intl:sv01',
            sortIndex: 1,
            names: ['professor s research'],
            number: '002',
            category: 'Trainer',
            subtype: 'Supporter',
            rarity: null,
            types: [],
            illustrator: null,
          },
        ]);
        expect(await engine.listCatalogSearchRows('asia')).toEqual([]);
      });

      it('replaces and removes search rows with their set', async () => {
        await engine.replaceCatalogSet(makeContractPack('intl', 'sv01', ['sv01-001', 'sv01-002']));
        await engine.replaceCatalogSet(makeContractPack('intl', 'sv02', ['sv02-001']));
        await engine.replaceCatalogSet(makeContractPack('asia', 'sv01', ['sv01-001']));

        await engine.replaceCatalogSet(makeContractPack('intl', 'sv01', ['sv01-002'], 'hash-2'));
        const keys = async (region: CatalogRegion) =>
          (await engine.listCatalogSearchRows(region)).map((row) => row.key).sort();
        expect(await keys('intl')).toEqual(['intl:sv01-002', 'intl:sv02-001']);

        await engine.deleteCatalogSet('intl', 'sv02');
        expect(await keys('intl')).toEqual(['intl:sv01-002']);
        expect(await keys('asia')).toEqual(['asia:sv01-001']);
      });

      it('moves a search row with a card that changed sets', async () => {
        await engine.replaceCatalogSet(makeContractPack('intl', 'sv01', ['sv01-001']));
        const moved = makeContractPack('intl', 'svp', []);
        moved.cards = [makeContractCard('intl', 'svp', 'sv01-001', 0)];

        await engine.replaceCatalogSet(moved);
        await engine.deleteCatalogSet('intl', 'sv01');

        expect(await engine.listCatalogSearchRows('intl')).toEqual([
          expect.objectContaining({ key: 'intl:sv01-001', setKey: 'intl:svp' }),
        ]);
      });

      it("rebuilds a set's search rows from its stored cards", async () => {
        await engine.replaceCatalogSet(multilingualPack());
        const before = await engine.listCatalogSearchRows('intl');

        await engine.reindexCatalogSet('intl', 'sv01');
        await engine.reindexCatalogSet('intl', 'unknown');

        const byKey = (a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key);
        expect((await engine.listCatalogSearchRows('intl')).sort(byKey)).toEqual(
          before.sort(byKey)
        );
      });
    });

    describe('card prices', () => {
      it('has none before any are downloaded', async () => {
        expect(await engine.getCatalogCardPrices('intl', 'sv01-001')).toBeUndefined();
      });

      it("stores a region's prices by card, keeping regions apart even when IDs repeat", async () => {
        await engine.replaceCatalogPrices(makeContractPricePack('intl', { 'sv01-001': 0.14 }));
        await engine.replaceCatalogPrices(makeContractPricePack('asia', { 'sv01-001': 8.33 }));

        expect(await engine.getCatalogCardPrices('intl', 'sv01-001')).toEqual(
          makeContractPrices(0.14)
        );
        expect((await engine.getCatalogCardPrices('asia', 'sv01-001'))?.base?.trend).toBe(8.33);
        expect(await engine.getCatalogCardPrices('intl', 'sv01-002')).toBeUndefined();
      });

      it("replaces a region's prices whole, leaving the other region's", async () => {
        await engine.replaceCatalogPrices(
          makeContractPricePack('intl', { 'sv01-001': 0.14, 'sv01-002': 1 })
        );
        await engine.replaceCatalogPrices(makeContractPricePack('asia', { 'SV2a-001': 0.02 }));

        await engine.replaceCatalogPrices(makeContractPricePack('intl', { 'sv01-001': 0.2 }, 2));

        expect((await engine.getCatalogCardPrices('intl', 'sv01-001'))?.base?.trend).toBe(0.2);
        expect(await engine.getCatalogCardPrices('intl', 'sv01-002')).toBeUndefined();
        expect((await engine.getCatalogCardPrices('asia', 'SV2a-001'))?.base?.trend).toBe(0.02);
      });

      it('stores more prices than one write batch holds', async () => {
        const prices = Object.fromEntries(
          Array.from({ length: 1201 }, (_, index) => [`c-${String(index)}`, index + 1])
        );

        await engine.replaceCatalogPrices(makeContractPricePack('intl', prices));

        expect((await engine.getCatalogCardPrices('intl', 'c-0'))?.base?.trend).toBe(1);
        expect((await engine.getCatalogCardPrices('intl', 'c-1200'))?.base?.trend).toBe(1201);
      });

      it('reads many cards’ prices by key, across regions and read batches', async () => {
        const prices = Object.fromEntries(
          Array.from({ length: 1201 }, (_, index) => [`c-${String(index)}`, index + 1])
        );
        await engine.replaceCatalogPrices(makeContractPricePack('intl', prices));
        await engine.replaceCatalogPrices(makeContractPricePack('asia', { 'SV2a-001': 0.02 }));

        const read = await engine.getCatalogPricesByKey([
          ...Object.keys(prices).map((cardId) => catalogKey('intl', cardId)),
          'asia:SV2a-001',
          'intl:unpriced',
          'asia:c-0',
        ]);

        expect(read.size).toBe(1202);
        expect(read.get('intl:c-1200')?.base?.trend).toBe(1201);
        expect(read.get('asia:SV2a-001')?.base?.trend).toBe(0.02);
        expect(read.has('intl:unpriced')).toBe(false);
        expect(read.has('asia:c-0')).toBe(false);
        expect(await engine.getCatalogPricesByKey([])).toEqual(new Map());
      });

      it('rolls prices back with the transaction they joined', async () => {
        await engine.replaceCatalogPrices(makeContractPricePack('intl', { 'sv01-001': 0.14 }));

        await expect(
          engine.runInTransaction(['catalogPrices'], async () => {
            await engine.replaceCatalogPrices(makeContractPricePack('intl', { 'sv01-002': 1 }, 2));
            throw new Error('boom');
          })
        ).rejects.toThrow('boom');

        expect((await engine.getCatalogCardPrices('intl', 'sv01-001'))?.base?.trend).toBe(0.14);
        expect(await engine.getCatalogCardPrices('intl', 'sv01-002')).toBeUndefined();
      });
    });

    describe('outbox', () => {
      it('supports put, get, ordered listing, bulk delete and clear', async () => {
        await engine.putOutboxEntry(
          makeContractOutboxEntry({ opId: 'late', createdAt: '2026-01-03T00:00:00.000Z' })
        );
        await engine.putOutboxEntry(
          makeContractOutboxEntry({ opId: 'early', createdAt: '2026-01-01T00:00:00.000Z' })
        );
        await engine.putOutboxEntry(
          makeContractOutboxEntry({ opId: 'middle', createdAt: '2026-01-02T00:00:00.000Z' })
        );

        expect((await engine.getOutboxEntry('middle'))?.opId).toBe('middle');
        expect((await engine.listOutboxOrderedByCreatedAt()).map((entry) => entry.opId)).toEqual([
          'early',
          'middle',
          'late',
        ]);

        await engine.bulkDeleteOutbox(['early', 'late']);
        expect((await engine.listOutboxOrderedByCreatedAt()).map((entry) => entry.opId)).toEqual([
          'middle',
        ]);

        await engine.clearOutbox();
        expect(await engine.listOutboxOrderedByCreatedAt()).toEqual([]);
      });

      it('putOutboxEntry replaces an entry with the same opId (e.g. to bump attemptCount)', async () => {
        await engine.putOutboxEntry(makeContractOutboxEntry());
        await engine.putOutboxEntry(
          makeContractOutboxEntry({ attemptCount: 2, lastError: 'server error' })
        );

        const entries = await engine.listOutboxOrderedByCreatedAt();
        expect(entries).toHaveLength(1);
        expect(entries[0]?.attemptCount).toBe(2);
        expect(entries[0]?.lastError).toBe('server error');
      });
    });

    describe('transactions', () => {
      it('atomically commits a domain write together with its outbox entry (the local-first write pattern)', async () => {
        await engine.runInTransaction(['settings', 'outbox'], async () => {
          await engine.putSettings(makeContractSettings({ cardLanguage: 'de' }));
          await engine.putOutboxEntry(makeContractOutboxEntry());
        });

        expect((await engine.getSettings())?.cardLanguage).toBe('de');
        expect(await engine.listOutboxOrderedByCreatedAt()).toHaveLength(1);
      });

      it('rolls back all writes when the action throws', async () => {
        await engine.putSyncMeta(makeContractSyncMetaEntry({ key: 'keep', value: 'kept' }));

        await expect(
          engine.runInTransaction(['settings', 'outbox', 'syncMeta'], async () => {
            await engine.putSettings(makeContractSettings({ cardLanguage: 'de' }));
            await engine.putOutboxEntry(makeContractOutboxEntry());
            await engine.putSyncMeta(makeContractSyncMetaEntry({ key: 'keep', value: 'changed' }));
            throw new Error('boom');
          })
        ).rejects.toThrow('boom');

        expect(await engine.getSettings()).toBeUndefined();
        expect(await engine.listOutboxOrderedByCreatedAt()).toEqual([]);
        expect((await engine.getSyncMeta('keep'))?.value).toBe('kept');
      });

      it('supports reads of own writes within a transaction', async () => {
        await engine.runInTransaction(['syncMeta'], async () => {
          await engine.putSyncMeta(makeContractSyncMetaEntry({ value: '7' }));
          const stored = await engine.getSyncMeta('pullCursor');
          expect(stored?.value).toBe('7');
          await engine.putSyncMeta(makeContractSyncMetaEntry({ value: '8' }));
        });

        expect((await engine.getSyncMeta('pullCursor'))?.value).toBe('8');
      });

      it('nested runInTransaction calls join the outer transaction', async () => {
        await engine.runInTransaction(['settings', 'syncMeta'], async () => {
          await engine.putSettings(makeContractSettings({ cardLanguage: 'it' }));

          await engine.runInTransaction(['syncMeta'], async () => {
            await engine.putSyncMeta(makeContractSyncMetaEntry({ key: 'nested', value: 'x' }));
          });
        });

        expect((await engine.getSettings())?.cardLanguage).toBe('it');
        expect((await engine.getSyncMeta('nested'))?.value).toBe('x');
      });

      it('rolls back nested writes when the inner action throws', async () => {
        await expect(
          engine.runInTransaction(['settings', 'syncMeta'], async () => {
            await engine.putSettings(makeContractSettings({ cardLanguage: 'it' }));

            await engine.runInTransaction(['syncMeta'], async () => {
              await engine.putSyncMeta(makeContractSyncMetaEntry({ key: 'nested', value: 'x' }));
              throw new Error('inner boom');
            });
          })
        ).rejects.toThrow('inner boom');

        expect(await engine.getSettings()).toBeUndefined();
        expect(await engine.getSyncMeta('nested')).toBeUndefined();
      });

      it('rejects a nested transaction whose scope the outer one does not cover, rolling back the outer', async () => {
        await expect(
          engine.runInTransaction(['settings', 'syncMeta'], async () => {
            await engine.putSettings(makeContractSettings({ cardLanguage: 'it' }));
            await engine.runInTransaction(['settings', 'outbox'], async () => {
              await engine.putOutboxEntry(makeContractOutboxEntry());
            });
          })
        ).rejects.toBeInstanceOf(NestedTransactionScopeError);

        expect(await engine.getSettings()).toBeUndefined();
        expect(await engine.listOutboxOrderedByCreatedAt()).toEqual([]);
      });

      it('a standalone write made while another transaction is open is not rolled back with it', async () => {
        let releaseTransaction: () => void = () => undefined;
        const held = new Promise<void>((resolve) => {
          releaseTransaction = resolve;
        });
        let transactionStarted: () => void = () => undefined;
        const started = new Promise<void>((resolve) => {
          transactionStarted = resolve;
        });

        const failing = engine.runInTransaction(['syncMeta', 'outbox'], async () => {
          await engine.putSyncMeta(makeContractSyncMetaEntry({ key: 'inside', value: 'x' }));
          transactionStarted();
          // Keep the transaction alive with storage work until released.
          const hold = { released: false };
          void held.then(() => {
            hold.released = true;
          });
          while (!hold.released) {
            await engine.getSyncMeta('inside');
          }
          throw new Error('boom');
        });

        await started;
        const standaloneWrite = engine.putOutboxEntry(makeContractOutboxEntry({ opId: 'outside' }));
        releaseTransaction();

        await expect(failing).rejects.toThrow('boom');
        await standaloneWrite;

        expect(await engine.getSyncMeta('inside')).toBeUndefined();
        expect((await engine.getOutboxEntry('outside'))?.opId).toBe('outside');
      });

      it('a standalone read made while another transaction is open does not see its uncommitted writes', async () => {
        let releaseTransaction: () => void = () => undefined;
        const held = new Promise<void>((resolve) => {
          releaseTransaction = resolve;
        });
        let transactionStarted: () => void = () => undefined;
        const started = new Promise<void>((resolve) => {
          transactionStarted = resolve;
        });

        const failing = engine.runInTransaction(['syncMeta'], async () => {
          await engine.putSyncMeta(makeContractSyncMetaEntry({ key: 'uncommitted', value: 'x' }));
          transactionStarted();
          const hold = { released: false };
          void held.then(() => {
            hold.released = true;
          });
          while (!hold.released) {
            await engine.getSyncMeta('uncommitted');
          }
          throw new Error('boom');
        });

        await started;
        const standaloneRead = engine.getSyncMeta('uncommitted');
        releaseTransaction();

        await expect(failing).rejects.toThrow('boom');
        expect(await standaloneRead).toBeUndefined();
      });

      it('serializes concurrent independent transactions', async () => {
        const events: string[] = [];

        const firstTransaction = engine.runInTransaction(['syncMeta'], async () => {
          events.push('tx1-start');
          await engine.putSyncMeta(makeContractSyncMetaEntry({ key: 'tx1' }));

          const holdUntil = Date.now() + 75;
          while (Date.now() < holdUntil) {
            await engine.getSyncMeta('tx1');
          }

          events.push('tx1-end');
        });

        await new Promise((resolve) => setTimeout(resolve, 10));

        const secondTransaction = engine.runInTransaction(['syncMeta'], async () => {
          events.push('tx2-start');
          await engine.putSyncMeta(makeContractSyncMetaEntry({ key: 'tx2' }));
          events.push('tx2-end');
        });

        await Promise.all([firstTransaction, secondTransaction]);

        expect(events.indexOf('tx1-end')).toBeLessThan(events.indexOf('tx2-start'));
        expect(await engine.getSyncMeta('tx1')).toBeDefined();
        expect(await engine.getSyncMeta('tx2')).toBeDefined();
      });
    });
  });
}
