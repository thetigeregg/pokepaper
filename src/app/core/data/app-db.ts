import Dexie, { Table } from 'dexie';
import { Injectable } from '@angular/core';
import type { CatalogCard, CatalogSeries, UserSettings } from '@pokepaper/shared';
import type {
  ImageCacheRecord,
  OutboxEntry,
  StoredCatalogSet,
  SyncMetaEntry,
} from './storage-engine';

/** The single `settings` row is always keyed `id: 1`. */
export type SettingsRow = { id: 1 } & UserSettings;

export interface CatalogSeriesRow {
  key: string;
  series: CatalogSeries;
}

export interface CatalogCardRow {
  key: string;
  setKey: string;
  sortIndex: number;
  card: CatalogCard;
}

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
  catalogSeries!: Table<CatalogSeriesRow, string>;
  catalogSets!: Table<StoredCatalogSet, string>;
  catalogCards!: Table<CatalogCardRow, string>;

  constructor() {
    super('pokepaper');

    this.version(1).stores({
      settings: 'id',
      imageCache: 'key',
      syncMeta: 'key',
      outbox: 'opId, createdAt',
    });

    // Card catalog (docs/catalog.md). Matches SQLite schema version 2.
    this.version(2).stores({
      catalogSeries: 'key',
      catalogSets: 'key, region',
      catalogCards: 'key, setKey',
    });
  }
}
