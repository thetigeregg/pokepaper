import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  CatalogCard,
  CatalogRegion,
  CatalogSeries,
  CatalogSetPack,
  UserSettings,
} from '@pokepaper/shared';
import { DEFAULT_SETTINGS, SETTINGS_ENTITY_ID } from '@pokepaper/shared';
import { NestedTransactionScopeError } from './storage-engine';
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
  return { key: 'sv1-001', blob: undefined, filePath: null, ...overrides };
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

      it('stores a set with its hash, and its cards in display order', async () => {
        const pack = makeContractPack('intl', 'sv01', ['sv01-001', 'sv01-002', 'sv01-003']);

        await engine.replaceCatalogSet(pack);

        expect(await engine.listCatalogSets()).toEqual([
          { key: 'intl:sv01', region: 'intl', hash: 'hash-sv01', cardCount: 3, set: pack.set },
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
          engine.runInTransaction(['catalogSets', 'catalogCards'], async () => {
            await engine.replaceCatalogSet(makeContractPack('intl', 'sv01', ['sv01-001']));
            throw new Error('boom');
          })
        ).rejects.toThrow('boom');

        expect(await engine.catalogStats()).toEqual({ sets: 0, cards: 0 });
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
