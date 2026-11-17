import { Injectable } from '@angular/core';
import { DEFAULT_SETTINGS, type SyncChange, type UserSettings } from '@pokepaper/shared';
import type { StorageEngine } from './storage-engine';
import type { SyncEntityApplier } from './sync-entity-applier';

/** Applies pulled `settings` changes. Settings are a singleton; a `delete`
 * resets them to defaults rather than removing the row. */
@Injectable({ providedIn: 'root' })
export class SettingsSyncApplier implements SyncEntityApplier {
  readonly entityType = 'settings' as const;
  readonly scopes = ['settings'] as const;

  apply(engine: StorageEngine, change: SyncChange): Promise<void> {
    if (change.operation === 'delete') {
      return engine.putSettings({ ...DEFAULT_SETTINGS });
    }

    return engine.putSettings({
      ...DEFAULT_SETTINGS,
      ...(change.payload as Partial<UserSettings>),
    });
  }
}
