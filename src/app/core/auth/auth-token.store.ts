import { Injectable } from '@angular/core';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';
import { isNativePlatform } from '../utils/native-platform.util';

/** Keychain key holding the iOS app's session bearer token. */
export const SESSION_TOKEN_KEY = 'pokepaper.auth.sessionToken';
/** Keychain key holding a signed-out session's token until the server has revoked it. */
export const REVOKE_TOKEN_KEY = 'pokepaper.auth.tokenToRevoke';

/** The plugin's rejection message for a key that doesn't exist (its only "empty" signal). */
const NOT_FOUND_MESSAGE = 'Item with given key does not exist';

/** The Keychain couldn't be read (e.g. the device hasn't been unlocked since it started). */
export class KeychainUnavailableError extends Error {
  override readonly name = 'KeychainUnavailableError';
}

/**
 * The iOS app's session tokens (docs/auth.md → Sessions), kept in the
 * Keychain. Web sessions use an httpOnly cookie instead, so on the web this
 * store is always empty and never touches storage.
 *
 * - The session token is cached after `load()`, so it can be read
 *   synchronously. If the Keychain can't be read (a launch before the first
 *   unlock, an OS error), the store stays unloaded and `requestToken()`
 *   retries: requests then fail as offline instead of going out without a
 *   token, whose 401 would otherwise end a perfectly good session.
 * - A sign-out the server couldn't confirm moves the token to a separate
 *   "to revoke" entry (`retireForRevocation()`). The app is signed out right
 *   away, and the token is kept only to finish the sign-out on the server.
 *   Being in the Keychain, it survives a reinstall, unlike Preferences.
 */
@Injectable({ providedIn: 'root' })
export class AuthTokenStore {
  private loaded = !isNativePlatform();
  private cached: string | null = null;
  private toRevoke: string | null = null;

  /** The current session token, or null (always null on the web, and until loaded). */
  token(): string | null {
    return this.cached;
  }

  /** A signed-out session's token that the server hasn't revoked yet, or null. */
  tokenToRevoke(): string | null {
    return this.toRevoke;
  }

  /**
   * The current token for an API request, loading the Keychain first if an
   * earlier read failed. Rejects with KeychainUnavailableError if it still
   * can't be read.
   */
  async requestToken(): Promise<string | null> {
    if (!this.loaded && !(await this.load())) {
      throw new KeychainUnavailableError('The Keychain is not available yet.');
    }
    return this.cached;
  }

  /**
   * Reads the tokens from the Keychain. Runs in an app initializer, before
   * any API request. Resolves false if the Keychain couldn't be read.
   */
  async load(): Promise<boolean> {
    if (!isNativePlatform()) {
      return true;
    }
    try {
      const [token, toRevoke] = await Promise.all([
        readKeychain(SESSION_TOKEN_KEY),
        readKeychain(REVOKE_TOKEN_KEY),
      ]);
      this.cached = token;
      this.toRevoke = toRevoke;
      this.loaded = true;
    } catch {
      this.loaded = false;
    }
    return this.loaded;
  }

  async set(token: string): Promise<void> {
    if (!isNativePlatform()) {
      return;
    }
    await SecureStoragePlugin.set({ key: SESSION_TOKEN_KEY, value: token });
    this.cached = token;
    this.loaded = true;
  }

  async clear(): Promise<void> {
    if (!isNativePlatform()) {
      return;
    }
    this.cached = null;
    await removeKeychain(SESSION_TOKEN_KEY);
  }

  /** Signs this device out locally while keeping the token to revoke on the server later. */
  async retireForRevocation(): Promise<void> {
    if (!isNativePlatform() || !this.cached) {
      return;
    }
    const token = this.cached;
    await SecureStoragePlugin.set({ key: REVOKE_TOKEN_KEY, value: token });
    this.toRevoke = token;
    await this.clear();
  }

  async clearRevocation(): Promise<void> {
    if (!isNativePlatform()) {
      return;
    }
    this.toRevoke = null;
    await removeKeychain(REVOKE_TOKEN_KEY);
  }
}

/** The stored value, or null when the key doesn't exist. Rethrows any other failure. */
async function readKeychain(key: string): Promise<string | null> {
  try {
    const { value } = await SecureStoragePlugin.get({ key });
    return value || null;
  } catch (error: unknown) {
    if (error instanceof Error && error.message === NOT_FOUND_MESSAGE) {
      return null;
    }
    throw error;
  }
}

async function removeKeychain(key: string): Promise<void> {
  try {
    await SecureStoragePlugin.remove({ key });
  } catch {
    // Already gone.
  }
}
