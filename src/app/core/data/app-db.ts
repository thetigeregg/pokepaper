import Dexie, { Table } from 'dexie';
import { Injectable } from '@angular/core';
import type {
  CatalogCard,
  CatalogSeries,
  CollectionEntry,
  Deck,
  UserSettings,
} from '@pokepaper/shared';
import type {
  CatalogSearchRow,
  DownloadedSet,
  ImageCacheRecord,
  ImagePin,
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

/** A collection entry, keyed by its `collectionEntryId`. */
export interface CollectionRow {
  key: string;
  entry: CollectionEntry;
}

/** A deck, keyed by its ID. */
export interface DeckRow {
  key: string;
  deck: Deck;
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
  catalogCardSearch!: Table<CatalogSearchRow, string>;
  imagePins!: Table<ImagePin, [string, string]>;
  downloadedSets!: Table<DownloadedSet, string>;
  collection!: Table<CollectionRow, string>;
  decks!: Table<DeckRow, string>;

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
      catalogCards: 'key, setKey, [setKey+sortIndex]',
    });

    // Image cache size limit and offline sets. Matches SQLite schema version 3.
    this.version(3).stores({
      imageCache: 'key, lastAccessedAt',
      imagePins: '[setKey+imageKey], setKey, imageKey',
      downloadedSets: 'setKey',
    });

    // Card search rows. Matches SQLite schema version 4. Existing catalogs
    // get their rows from CatalogSearchService's rebuild.
    this.version(4).stores({
      catalogCardSearch: 'key, region, setKey',
    });

    // Collection entries (docs/collection.md). Matches SQLite schema version 5.
    this.version(5).stores({
      collection: 'key',
    });

    // Decks (docs/decks.md). Matches SQLite schema version 6.
    this.version(6).stores({
      decks: 'key',
    });
  }
}
