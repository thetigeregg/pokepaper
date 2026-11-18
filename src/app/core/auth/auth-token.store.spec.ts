import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import {
  AuthTokenStore,
  KeychainUnavailableError,
  REVOKE_TOKEN_KEY,
  SESSION_TOKEN_KEY,
} from './auth-token.store';

const isNativePlatformMock = vi.fn<() => boolean>();

vi.mock('../utils/native-platform.util', () => ({
  isNativePlatform: () => isNativePlatformMock(),
}));

const NOT_FOUND = 'Item with given key does not exist';

/** In-memory Keychain behind the plugin's API (missing keys reject like the plugin does). */
const keychain = new Map<string, string>();
let keychainError: Error | null = null;

const secureGet = vi.fn((options: { key: string }) => {
  if (keychainError) {
    return Promise.reject(keychainError);
  }
  const value = keychain.get(options.key);
  return value === undefined ? Promise.reject(new Error(NOT_FOUND)) : Promise.resolve({ value });
});
const secureSet = vi.fn((options: { key: string; value: string }) => {
  if (keychainError) {
    return Promise.reject(keychainError);
  }
  keychain.set(options.key, options.value);
  return Promise.resolve({ value: true });
});
const secureRemove = vi.fn((options: { key: string }) =>
  keychain.delete(options.key)
    ? Promise.resolve({ value: true })
    : Promise.reject(new Error(NOT_FOUND))
);

vi.mock('capacitor-secure-storage-plugin', () => ({
  SecureStoragePlugin: {
    get: (options: { key: string }) => secureGet(options),
    set: (options: { key: string; value: string }) => secureSet(options),
    remove: (options: { key: string }) => secureRemove(options),
  },
}));

function createStore(native: boolean): AuthTokenStore {
  isNativePlatformMock.mockReturnValue(native);
  TestBed.resetTestingModule();
  return TestBed.inject(AuthTokenStore);
}

describe('AuthTokenStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    keychain.clear();
    keychainError = null;
  });

  describe('on the web', () => {
    it('never touches storage and has no token', async () => {
      const tokens = createStore(false);

      await tokens.load();
      await tokens.set('ignored');
      await tokens.retireForRevocation();
      await tokens.clearRevocation();
      await tokens.clear();

      expect(tokens.token()).toBeNull();
      expect(tokens.tokenToRevoke()).toBeNull();
      await expect(tokens.requestToken()).resolves.toBeNull();
      expect(secureGet).not.toHaveBeenCalled();
      expect(secureSet).not.toHaveBeenCalled();
      expect(secureRemove).not.toHaveBeenCalled();
    });
  });

  describe('in the iOS app', () => {
    it('loads both tokens from the Keychain', async () => {
      keychain.set(SESSION_TOKEN_KEY, 'tok-1');
      keychain.set(REVOKE_TOKEN_KEY, 'tok-0');
      const tokens = createStore(true);

      await tokens.load();

      expect(tokens.token()).toBe('tok-1');
      expect(tokens.tokenToRevoke()).toBe('tok-0');
      await expect(tokens.requestToken()).resolves.toBe('tok-1');
    });

    it('treats missing Keychain entries as no token', async () => {
      const tokens = createStore(true);

      await tokens.load();

      expect(tokens.token()).toBeNull();
      expect(tokens.tokenToRevoke()).toBeNull();
      await expect(tokens.requestToken()).resolves.toBeNull();
    });

    it('retries an unreadable Keychain before each request instead of reporting no token', async () => {
      keychain.set(SESSION_TOKEN_KEY, 'tok-1');
      keychainError = new Error('errSecInteractionNotAllowed');
      const tokens = createStore(true);

      await tokens.load();
      expect(tokens.token()).toBeNull();
      await expect(tokens.requestToken()).rejects.toBeInstanceOf(KeychainUnavailableError);

      keychainError = null;
      await expect(tokens.requestToken()).resolves.toBe('tok-1');
    });

    it('stores and clears the session token', async () => {
      const tokens = createStore(true);
      await tokens.load();

      await tokens.set('tok-2');
      expect(keychain.get(SESSION_TOKEN_KEY)).toBe('tok-2');
      expect(tokens.token()).toBe('tok-2');

      await tokens.clear();
      expect(keychain.has(SESSION_TOKEN_KEY)).toBe(false);
      expect(tokens.token()).toBeNull();

      await expect(tokens.clear()).resolves.toBeUndefined();
    });

    it('keeps the old token if the Keychain write fails', async () => {
      keychain.set(SESSION_TOKEN_KEY, 'old');
      const tokens = createStore(true);
      await tokens.load();

      keychainError = new Error('keychain locked');
      await expect(tokens.set('new')).rejects.toThrow('keychain locked');
      expect(tokens.token()).toBe('old');
    });

    it('retires the session token for revocation, then forgets it', async () => {
      keychain.set(SESSION_TOKEN_KEY, 'tok-1');
      const tokens = createStore(true);
      await tokens.load();

      await tokens.retireForRevocation();
      expect(tokens.token()).toBeNull();
      expect(tokens.tokenToRevoke()).toBe('tok-1');
      expect(keychain.has(SESSION_TOKEN_KEY)).toBe(false);
      expect(keychain.get(REVOKE_TOKEN_KEY)).toBe('tok-1');

      await tokens.clearRevocation();
      expect(tokens.tokenToRevoke()).toBeNull();
      expect(keychain.has(REVOKE_TOKEN_KEY)).toBe(false);
    });

    it('has nothing to retire without a session token', async () => {
      const tokens = createStore(true);
      await tokens.load();

      await tokens.retireForRevocation();

      expect(tokens.tokenToRevoke()).toBeNull();
      expect(secureSet).not.toHaveBeenCalled();
    });
  });
});
