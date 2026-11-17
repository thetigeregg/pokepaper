import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';

/**
 * Thin wrapper around @capacitor/preferences for small key-value settings
 * (UI chrome state, etc.) — distinct from the structured `StorageEngine`,
 * which holds synced domain data.
 *
 * `@capacitor/preferences` falls back to localStorage on web automatically,
 * so no platform branching is needed here.
 */
@Injectable({ providedIn: 'root' })
export class PreferenceStorageService {
  async getItem(key: string): Promise<string | null> {
    const result = await Preferences.get({ key });
    return result.value;
  }

  async setItem(key: string, value: string): Promise<void> {
    await Preferences.set({ key, value });
  }

  async removeItem(key: string): Promise<void> {
    await Preferences.remove({ key });
  }
}
