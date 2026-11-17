import { TestBed } from '@angular/core/testing';
import { vi, type Mock } from 'vitest';
import { DexieStorageEngine } from './dexie-storage-engine';
import type { SqliteConnection } from './sqlite-connection';
import { SqliteStorageEngine } from './sqlite-storage-engine';
import { makeContractOutboxEntry } from './storage-engine.contract';
import type { OutboxEntry } from './storage-engine';
import { StorageEngineFactory } from './storage-engine.factory';

const isNativePlatformMock = vi.fn<() => boolean>();
const openConnectionMock = vi.fn<() => Promise<SqliteConnection>>();

vi.mock('../utils/native-platform.util', () => ({
  isNativePlatform: () => isNativePlatformMock(),
}));

vi.mock('./storage-transaction-context', () => import('./storage-transaction-context.node'));

vi.mock('./sqlite-connection', () => ({
  openCapacitorSqliteConnection: () => openConnectionMock(),
}));

/** Mocked connection; `query` is generic, so it stays a plain (unmocked) function. */
type FakeConnection = {
  [K in Exclude<keyof SqliteConnection, 'query'>]: Mock<SqliteConnection[K]>;
} & Pick<SqliteConnection, 'query'>;

function fakeConnection(): FakeConnection {
  return {
    run: vi.fn(() => Promise.resolve({ changes: 1, lastId: undefined })),
    query: <T>() => Promise.resolve<T[]>([]),
    executeSet: vi.fn(() => Promise.resolve()),
    beginTransaction: vi.fn(() => Promise.resolve()),
    commitTransaction: vi.fn(() => Promise.resolve()),
    rollbackTransaction: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  };
}

describe('StorageEngineFactory', () => {
  let dexieEngine: {
    initialize: ReturnType<typeof vi.fn>;
    listOutboxOrderedByCreatedAt: ReturnType<typeof vi.fn<() => Promise<OutboxEntry[]>>>;
    bulkDeleteOutbox: ReturnType<typeof vi.fn>;
  };
  let factory: StorageEngineFactory;

  beforeEach(() => {
    vi.clearAllMocks();
    dexieEngine = {
      initialize: vi.fn(() => Promise.resolve()),
      listOutboxOrderedByCreatedAt: vi.fn(() => Promise.resolve([])),
      bulkDeleteOutbox: vi.fn(() => Promise.resolve()),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: DexieStorageEngine, useValue: dexieEngine }],
    });
    factory = TestBed.inject(StorageEngineFactory);
  });

  it('throws if the engine is requested before initialize()', () => {
    expect(() => factory.getEngine()).toThrow(/initialize\(\) must complete/);
  });

  it('uses Dexie on the web', async () => {
    isNativePlatformMock.mockReturnValue(false);

    await factory.initialize();

    expect(factory.getEngine()).toBe(dexieEngine);
    expect(dexieEngine.initialize).toHaveBeenCalledTimes(1);
    expect(openConnectionMock).not.toHaveBeenCalled();
  });

  it('uses SQLite on native platforms', async () => {
    isNativePlatformMock.mockReturnValue(true);
    openConnectionMock.mockResolvedValue(fakeConnection());

    await factory.initialize();

    expect(factory.getEngine()).toBeInstanceOf(SqliteStorageEngine);
    expect(dexieEngine.initialize).not.toHaveBeenCalled();
  });

  it('falls back to Dexie when SQLite cannot be opened', async () => {
    isNativePlatformMock.mockReturnValue(true);
    openConnectionMock.mockRejectedValue(new Error('plugin unavailable'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await factory.initialize();

    expect(factory.getEngine()).toBe(dexieEngine);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('moves outbox entries stranded in Dexie by a fallback session into SQLite', async () => {
    isNativePlatformMock.mockReturnValue(true);
    const connection = fakeConnection();
    openConnectionMock.mockResolvedValue(connection);
    dexieEngine.listOutboxOrderedByCreatedAt.mockResolvedValue([
      makeContractOutboxEntry({ opId: 'stranded-1' }),
      makeContractOutboxEntry({ opId: 'stranded-2' }),
    ]);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await factory.initialize();

    const insertedOpIds = connection.run.mock.calls
      .filter(([statement]) => statement.includes('INSERT INTO outbox'))
      .map(([, values]) => values[0]);
    expect(insertedOpIds).toEqual(['stranded-1', 'stranded-2']);
    expect(connection.beginTransaction).toHaveBeenCalled();
    expect(connection.commitTransaction).toHaveBeenCalled();
    expect(dexieEngine.bulkDeleteOutbox).toHaveBeenCalledWith(['stranded-1', 'stranded-2']);
    consoleWarn.mockRestore();
  });

  it('keeps stranded entries in Dexie and still boots when recovery fails', async () => {
    isNativePlatformMock.mockReturnValue(true);
    openConnectionMock.mockResolvedValue(fakeConnection());
    dexieEngine.listOutboxOrderedByCreatedAt.mockRejectedValue(new Error('idb unavailable'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await factory.initialize();

    expect(factory.getEngine()).toBeInstanceOf(SqliteStorageEngine);
    expect(dexieEngine.bulkDeleteOutbox).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      'storage.fallback_outbox_recovery_failed',
      expect.any(Error)
    );
    consoleError.mockRestore();
  });

  it('is idempotent', async () => {
    isNativePlatformMock.mockReturnValue(false);

    await factory.initialize();
    await factory.initialize();

    expect(dexieEngine.initialize).toHaveBeenCalledTimes(1);
  });
});
