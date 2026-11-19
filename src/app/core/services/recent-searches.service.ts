import { Injectable, inject, signal } from '@angular/core';
import { PreferenceStorageService } from '../storage/preference-storage.service';
import { normalizeSearchText, prepareQuery } from '../utils/search-text.util';

/** Preference: recent searches, newest first (JSON array of strings). */
export const RECENT_SEARCHES_KEY = 'pokepaper.cards.recentSearches';
export const MAX_RECENT_SEARCHES = 10;

/**
 * Recent card searches, kept on the device and shared by every search
 * screen (the Cards tab and a deck's Add cards search the same catalog).
 */
@Injectable({ providedIn: 'root' })
export class RecentSearchesService {
  private readonly preferences = inject(PreferenceStorageService);

  private readonly _recent = signal<string[]>([]);
  /** Newest first, at most `MAX_RECENT_SEARCHES`. */
  readonly recent = this._recent.asReadonly();
  private readonly loaded: Promise<void>;

  constructor() {
    this.loaded = this.load();
  }

  /** Remembers `query` (trimmed) as the newest recent search, replacing an equal one. */
  async remember(query: string): Promise<void> {
    const trimmed = query.trim();
    if (!prepareQuery(trimmed)) {
      return;
    }
    await this.loaded; // Else the stored list would be overwritten.
    const normalized = normalizeSearchText(trimmed);
    const recent = [
      trimmed,
      ...this._recent().filter((entry) => normalizeSearchText(entry) !== normalized),
    ].slice(0, MAX_RECENT_SEARCHES);
    this._recent.set(recent);
    await this.save(recent);
  }

  async clear(): Promise<void> {
    await this.loaded; // Else it would load back afterwards.
    this._recent.set([]);
    await this.save([]);
  }

  private async load(): Promise<void> {
    try {
      const stored: unknown = JSON.parse(
        (await this.preferences.getItem(RECENT_SEARCHES_KEY)) ?? '[]'
      );
      if (Array.isArray(stored)) {
        this._recent.set(
          stored
            .filter((entry): entry is string => typeof entry === 'string')
            .slice(0, MAX_RECENT_SEARCHES)
        );
      }
    } catch (error: unknown) {
      console.error('catalog.recent_searches_load_failed', error);
    }
  }

  private async save(recent: string[]): Promise<void> {
    try {
      await this.preferences.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recent));
    } catch (error: unknown) {
      console.error('catalog.recent_searches_save_failed', error);
    }
  }
}
