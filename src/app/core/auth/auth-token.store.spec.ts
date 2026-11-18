import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AuthTokenStore, SESSION_TOKEN_KEY } from './auth-token.store';

const isNativePlatformMock = vi.fn<() => boolean>();

vi.mock('../utils/native-platform.util', () => ({
  isNativePlatform: () => isNativePlatformMock(),
}));

const secureGet = vi.fn<(options: { key: string }) => Promise<{ value: string }>>();
const secureSet = vi.fn<(options: { key: string; value: string }) => Promise<{ value: boolean }>>();
const secureRemove = vi.fn<(options: { key: string }) => Promise<{ value: boolean }>>();

vi.mock('capacitor-secure-storage-plugin', () => ({
  SecureStoragePlugin: {
    get: (options: { key: string }) => secureGet(options),
    set: (options: { key: string; value: string }) => secureSet(options),
    remove: (options: { key: string }) => secureRemove(options),
  },
}));

describe('AuthTokenStore', () => {
  let tokens: AuthTokenStore;

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.resetTestingModule();
    tokens = TestBed.inject(AuthTokenStore);
  });

  describe('on the web', () => {
    beforeEach(() => isNativePlatformMock.mockReturnValue(false));

    it('never touches storage and has no token', async () => {
      await tokens.load();
      await tokens.set('ignored');
      await tokens.clear();

      expect(tokens.token()).toBeNull();
      expect(secureGet).not.toHaveBeenCalled();
      expect(secureSet).not.toHaveBeenCalled();
      expect(secureRemove).not.toHaveBeenCalled();
    });
  });

  describe('in the iOS app', () => {
    beforeEach(() => isNativePlatformMock.mockReturnValue(true));

    it('loads the token from the Keychain', async () => {
      secureGet.mockResolvedValue({ value: 'tok-1' });

      await tokens.load();

      expect(secureGet).toHaveBeenCalledWith({ key: SESSION_TOKEN_KEY });
      expect(tokens.token()).toBe('tok-1');
    });

    it('treats a missing Keychain entry as no token', async () => {
      secureGet.mockRejectedValue(new Error('Item with given key does not exist'));

      await tokens.load();

      expect(tokens.token()).toBeNull();
    });

    it('stores and clears the token', async () => {
      secureSet.mockResolvedValue({ value: true });
      secureRemove.mockRejectedValue(new Error('already gone'));

      await tokens.set('tok-2');
      expect(secureSet).toHaveBeenCalledWith({
        key: SESSION_TOKEN_KEY,
        value: 'tok-2',
      });
      expect(tokens.token()).toBe('tok-2');

      await tokens.clear();
      expect(secureRemove).toHaveBeenCalledWith({ key: SESSION_TOKEN_KEY });
      expect(tokens.token()).toBeNull();
    });

    it('keeps the old token if the Keychain write fails', async () => {
      secureGet.mockResolvedValue({ value: 'old' });
      secureSet.mockRejectedValue(new Error('keychain locked'));
      await tokens.load();

      await expect(tokens.set('new')).rejects.toThrow('keychain locked');
      expect(tokens.token()).toBe('old');
    });
  });
});
