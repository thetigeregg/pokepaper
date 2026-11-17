import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UserSettings } from '@pokepaper/shared';
import { DEFAULT_SETTINGS, SETTINGS_ENTITY_ID } from '@pokepaper/shared';
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
