/**
 * User-level settings, synced between devices as a single entity
 * (`entityType: 'settings'`, `entityId: SETTINGS_ENTITY_ID`).
 */
export interface UserSettings {
  /** Preferred card language code (TCGdex language codes, e.g. `en`, `ja`). */
  cardLanguage: string;
}

export const SETTINGS_ENTITY_ID = 'settings';

export const DEFAULT_SETTINGS: UserSettings = {
  cardLanguage: 'en',
};
