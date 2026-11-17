import Dexie, { Table } from 'dexie';
import { Injectable } from '@angular/core';
import type { UserSettings } from '@pokepaper/shared';
import type { ImageCacheRecord, OutboxEntry, SyncMetaEntry } from './storage-engine';

/** The single `settings` row is always keyed `id: 1`. */
export type SettingsRow = { id: 1 } & UserSettings;

/**
 * IndexedDB schema for the web storage engine. Add a new `this.version(n)`
 * block (never edit an existing one) when a feature adds or re-indexes a
 * table; keep it in step with `SQLITE_UPGRADE_STATEMENTS`.
 */
@Injectable({ providedIn: 'root' })
export class AppDb extends Dexie {
  settings!: Table<SettingsRow, number>;
  imageCache!: Table<ImageCacheRecord, string>;
  syncMeta!: Table<SyncMetaEntry, string>;
  outbox!: Table<OutboxEntry, string>;

  constructor() {
    super('pokepaper');

    this.version(1).stores({
      settings: 'id',
      imageCache: 'key',
      syncMeta: 'key',
      outbox: 'opId, createdAt',
    });
  }
}
