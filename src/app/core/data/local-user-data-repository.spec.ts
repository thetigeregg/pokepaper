import 'fake-indexeddb/auto';
import { TestBed } from '@angular/core/testing';
import { DEFAULT_SETTINGS, SETTINGS_ENTITY_ID } from '@pokepaper/shared';
import { vi } from 'vitest';
import { AppDb } from './app-db';
import { DexieStorageEngine } from './dexie-storage-engine';
import { LocalUserDataRepository } from './local-user-data-repository';
import { StorageEngineFactory } from './storage-engine.factory';
import { SYNC_OUTBOX_WRITER, SyncOutboxWriter } from './sync-outbox-writer';

vi.mock('./storage-transaction-context', () => import('./storage-transaction-context.node'));

describe('LocalUserDataRepository', () => {
  let db: AppDb;
  let engine: DexieStorageEngine;

  async function setUp(outboxWriter: SyncOutboxWriter | null): Promise<LocalUserDataRepository> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        AppDb,
        DexieStorageEngine,
        StorageEngineFactory,
        ...(outboxWriter ? [{ provide: SYNC_OUTBOX_WRITER, useValue: outboxWriter }] : []),
      ],
    });

    db = TestBed.inject(AppDb);
    engine = TestBed.inject(DexieStorageEngine);
    await TestBed.inject(StorageEngineFactory).initialize();
    return TestBed.inject(LocalUserDataRepository);
  }

  afterEach(async () => {
    await db.delete();
  });

  it('getSettings returns defaults before anything is stored', async () => {
    const repository = await setUp(null);

    expect(await repository.getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('updateSettings writes settings and an outbox entry atomically, then requests a sync', async () => {
    const syncNow = vi.fn(() => Promise.resolve());
    const onOutboxEntryEnqueued = vi.fn();
    const writer: SyncOutboxWriter = { syncNow, onOutboxEntryEnqueued };
    const repository = await setUp(writer);

    await repository.updateSettings({ cardLanguage: 'ja' });

    expect(await repository.getSettings()).toEqual({ cardLanguage: 'ja' });
    const [entry] = await engine.listOutboxOrderedByCreatedAt();
    expect(entry).toMatchObject({
      entityType: 'settings',
      entityId: SETTINGS_ENTITY_ID,
      operation: 'upsert',
      payload: { cardLanguage: 'ja' },
      attemptCount: 0,
    });
    expect(onOutboxEntryEnqueued).toHaveBeenCalledWith(entry);
    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it('a failing observability hook or sync trigger does not break the write', async () => {
    const writer: SyncOutboxWriter = {
      syncNow: vi.fn(() => {
        throw new Error('sync exploded');
      }),
      onOutboxEntryEnqueued: vi.fn(() => {
        throw new Error('hook exploded');
      }),
    };
    const repository = await setUp(writer);

    await expect(repository.updateSettings({ cardLanguage: 'fr' })).resolves.toBeUndefined();
    expect((await repository.getSettings()).cardLanguage).toBe('fr');
  });

  describe('collection', () => {
    const target = {
      region: 'intl',
      cardId: 'sv01-001',
      setId: 'sv01',
      variant: 'holo',
      language: 'de',
    };
    const entityId = 'intl:sv01-001:holo:de';

    it('setCollectionQuantity stores the entry and queues an upsert', async () => {
      const syncNow = vi.fn(() => Promise.resolve());
      const repository = await setUp({ syncNow });

      await repository.setCollectionQuantity(target, 3);

      expect(await repository.listCollection()).toEqual([{ ...target, quantity: 3 }]);
      expect(await engine.listOutboxOrderedByCreatedAt()).toEqual([
        expect.objectContaining({
          entityType: 'collectionEntry',
          entityId,
          operation: 'upsert',
          payload: { ...target, quantity: 3 },
        }),
      ]);
      expect(syncNow).toHaveBeenCalledTimes(1);
    });

    it('stores only the entry fields, whatever else the target carries', async () => {
      const repository = await setUp(null);

      await repository.setCollectionQuantity({ ...target, extra: true } as typeof target, 1);

      expect(await repository.listCollection()).toEqual([{ ...target, quantity: 1 }]);
    });

    it('a quantity of 0 deletes the entry and queues a delete', async () => {
      const repository = await setUp({ syncNow: () => Promise.resolve() });
      await repository.setCollectionQuantity(target, 2);

      await repository.setCollectionQuantity(target, 0);

      expect(await repository.listCollection()).toEqual([]);
      expect((await engine.listOutboxOrderedByCreatedAt()).at(-1)).toMatchObject({
        entityType: 'collectionEntry',
        entityId,
        operation: 'delete',
        payload: null,
      });
    });

    it.each([
      ['a colon in the variant', { ...target, variant: 'ho:lo' }],
      ['an oversized language', { ...target, language: 'x'.repeat(17) }],
      ['an empty set', { ...target, setId: '' }],
    ])('rejects %s without writing anything, for deletes too', async (_label, invalid) => {
      const repository = await setUp({ syncNow: () => Promise.resolve() });

      await expect(repository.setCollectionQuantity(invalid, 1)).rejects.toThrow(TypeError);
      await expect(repository.setCollectionQuantity(invalid, 0)).rejects.toThrow(TypeError);
      expect(await repository.listCollection()).toEqual([]);
      expect(await engine.listOutboxOrderedByCreatedAt()).toEqual([]);
    });

    it.each([[-1], [1.5], [1000], [Number.NaN]])(
      'rejects the quantity %s without writing anything',
      async (quantity) => {
        const repository = await setUp({ syncNow: () => Promise.resolve() });

        await expect(repository.setCollectionQuantity(target, quantity)).rejects.toThrow(
          RangeError
        );
        expect(await repository.listCollection()).toEqual([]);
        expect(await engine.listOutboxOrderedByCreatedAt()).toEqual([]);
      }
    );
  });

  it('without an outbox writer, writes locally and queues nothing', async () => {
    const repository = await setUp(null);

    await repository.updateSettings({ cardLanguage: 'de' });

    expect((await repository.getSettings()).cardLanguage).toBe('de');
    expect(await engine.listOutboxOrderedByCreatedAt()).toEqual([]);
  });
});
