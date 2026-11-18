import { Injectable } from '@angular/core';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';
import { isNativePlatform } from '../utils/native-platform.util';

/** Keychain key holding the iOS app's session bearer token. */
export const SESSION_TOKEN_KEY = 'pokepaper.auth.sessionToken';

/**
 * The iOS app's session token (docs/auth.md → Sessions), kept in the
 * Keychain. Web sessions use an httpOnly cookie instead, so on the web this
 * store is always empty and never touches storage.
 *
 * The token is cached in memory after `load()`, so the HTTP interceptor can
 * attach it synchronously to every API request.
 */
@Injectable({ providedIn: 'root' })
export class AuthTokenStore {
  private cached: string | null = null;

  /** The current token, or null when there is none (always null on the web). */
  token(): string | null {
    return this.cached;
  }

  /** Reads the token from the Keychain. Runs in an app initializer, before any API request. */
  async load(): Promise<void> {
    if (!isNativePlatform()) {
      return;
    }
    try {
      const { value } = await SecureStoragePlugin.get({ key: SESSION_TOKEN_KEY });
      this.cached = value || null;
    } catch {
      // The plugin rejects when the key doesn't exist: no token yet.
      this.cached = null;
    }
  }

  async set(token: string): Promise<void> {
    if (!isNativePlatform()) {
      return;
    }
    await SecureStoragePlugin.set({ key: SESSION_TOKEN_KEY, value: token });
    this.cached = token;
  }

  async clear(): Promise<void> {
    if (!isNativePlatform()) {
      return;
    }
    this.cached = null;
    try {
      await SecureStoragePlugin.remove({ key: SESSION_TOKEN_KEY });
    } catch {
      // Already gone.
    }
  }
}
