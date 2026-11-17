import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { DexieStorageEngine } from './dexie-storage-engine';
import type { SqliteConnection } from './sqlite-connection';
import { SqliteStorageEngine } from './sqlite-storage-engine';
import { StorageEngineFactory } from './storage-engine.factory';

const isNativePlatformMock = vi.fn<() => boolean>();
const openConnectionMock = vi.fn<() => Promise<SqliteConnection>>();

vi.mock('../utils/native-platform.util', () => ({
  isNativePlatform: () => isNativePlatformMock(),
}));

vi.mock('./sqlite-connection', () => ({
  openCapacitorSqliteConnection: () => openConnectionMock(),
}));

function fakeConnection(): SqliteConnection {
  return {
    run: vi.fn(),
    query: vi.fn(),
    executeSet: vi.fn(),
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    rollbackTransaction: vi.fn(),
    close: vi.fn(() => Promise.resolve()),
  };
}

describe('StorageEngineFactory', () => {
  let dexieEngine: { initialize: ReturnType<typeof vi.fn> };
  let factory: StorageEngineFactory;

  beforeEach(() => {
    vi.clearAllMocks();
    dexieEngine = { initialize: vi.fn(() => Promise.resolve()) };

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

  it('is idempotent', async () => {
    isNativePlatformMock.mockReturnValue(false);

    await factory.initialize();
    await factory.initialize();

    expect(dexieEngine.initialize).toHaveBeenCalledTimes(1);
  });
});
