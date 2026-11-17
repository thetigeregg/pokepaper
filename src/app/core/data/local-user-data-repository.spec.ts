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
    const writer: SyncOutboxWriter = { enqueueOperation: vi.fn(), syncNow, onOutboxEntryEnqueued };
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
      enqueueOperation: vi.fn(),
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

  it('without an outbox writer, writes locally and queues nothing', async () => {
    const repository = await setUp(null);

    await repository.updateSettings({ cardLanguage: 'de' });

    expect((await repository.getSettings()).cardLanguage).toBe('de');
    expect(await engine.listOutboxOrderedByCreatedAt()).toEqual([]);
  });
});
