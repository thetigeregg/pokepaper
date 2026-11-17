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

/** Runtime shape check for settings payloads (used by the server to validate pushes). */
export function isUserSettings(value: unknown): value is UserSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const { cardLanguage } = value as Record<string, unknown>;
  return typeof cardLanguage === 'string' && cardLanguage.length > 0 && cardLanguage.length <= 16;
}
