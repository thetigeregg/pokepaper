import { InjectionToken } from '@angular/core';
import type {
  CatalogCard,
  CatalogLanguage,
  CatalogRegion,
  CatalogSeries,
  CatalogSet,
  CatalogSetPack,
  CollectionEntry,
  SyncEntityType,
  SyncOperation,
  UserSettings,
} from '@pokepaper/shared';

/**
 * Logical stores that can participate in a storage transaction.
 *
 * Domain stores are added by their feature phases. Each one gets a scope
 * here, a Dexie table in `app-db.ts`, a SQLite migration in
 * `sqlite-connection.ts`, and coverage in the shared contract suite
 * (`storage-engine.contract.ts`).
 */
export type StorageScope =
  | 'settings'
  | 'imageCache'
  | 'syncMeta'
  | 'outbox'
  | 'catalogSeries'
  | 'catalogSets'
  | 'catalogCards'
  | 'catalogCardSearch'
  | 'imagePins'
  | 'downloadedSets'
  | 'collection';

/** Catalog rows are keyed `region:id` (IDs repeat across regions; docs/catalog.md). */
export function catalogKey(region: CatalogRegion, id: string): string {
  return `${region}:${id}`;
}

/** A downloaded set and the hash it was downloaded at (compared with the manifest). */
export interface StoredCatalogSet {
  key: string;
  region: CatalogRegion;
  hash: string;
  set: CatalogSet;
}

/**
 * A card's search fields (docs/catalog.md → Search): written with its set by
 * `replaceCatalogSet` and built by `catalogSearchRow()`, so both engines
 * store identical rows. Slim enough to keep a whole catalog in memory.
 */
export interface CatalogSearchRow {
  /** `region:id`, as the card's key. */
  key: string;
  region: CatalogRegion;
  /** `region:setId`. */
  setKey: string;
  sortIndex: number;
  /** The card's names in every language, normalized (`normalizeSearchText`), without repeats. */
  names: string[];
  category: string;
  /** Trainer or Energy subtype (`Supporter`, `Special`, …). */
  subtype: string | null;
  rarity: string | null;
  types: string[];
}

/** Counts for the catalog on this device. */
export interface CatalogStats {
  sets: number;
  cards: number;
}

/**
 * A queued local write awaiting push-sync to the backend. The backend is the
 * durable source of truth; local writes land in their domain store *and* here
 * in one transaction (see `local-user-data-repository.ts`), then
 * `SyncService` pushes them in `createdAt` order.
 */
export interface OutboxEntry {
  opId: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  payload: unknown;
  clientTimestamp: string;
  createdAt: string;
  attemptCount: number;
  lastError: string | null;
}

/**
 * Image cache row, keyed by the image's same-origin URL path (e.g.
 * `/images/catalog/cards/intl/sv01-001/en/low.webp`). The web engine keeps
 * the bytes inline (`blob`); the native engine stores them on the
 * filesystem and keeps only a relative `filePath` here.
 */
export interface ImageCacheRecord {
  key: string;
  blob?: Blob;
  filePath?: string | null;
  /** Bytes, for the cache size limit. */
  size: number;
  /** ISO time it was last shown, for least-recently-viewed eviction. */
  lastAccessedAt: string;
}

/** An image kept for offline use by a downloaded set (`setKey` = `region:setId`). */
export interface ImagePin {
  setKey: string;
  imageKey: string;
}

/** A set downloaded for offline use, and the languages its images were downloaded in. */
export interface DownloadedSet {
  /** `region:setId`. */
  setKey: string;
  languages: CatalogLanguage[];
  downloadedAt: string;
}

/** Where an image's bytes live, for deleting them. */
export type StoredImageRef = Pick<ImageCacheRecord, 'key' | 'filePath' | 'size'>;

/** Cached image bytes, split by whether a downloaded set pins them. */
export interface ImageCacheUsage {
  pinnedBytes: number;
  unpinnedBytes: number;
}

/** A downloaded set's pinned images that are on the device. */
export interface PinnedSetSummary {
  setKey: string;
  images: number;
  bytes: number;
}

/** A single sync-metadata key/value pair (e.g. pull cursor, catalog version). */
export interface SyncMetaEntry {
  key: string;
  value: string;
}

/**
 * Platform-agnostic local persistence interface for all structured app data.
 *
 * Implementations: DexieStorageEngine (web, IndexedDB) and SqliteStorageEngine
 * (native iOS, @capacitor-community/sqlite). Business logic (repositories,
 * services) must only talk to this interface.
 *
 * Semantics:
 * - `put*` inserts or replaces by primary key.
 * - `runInTransaction` runs the action atomically over the given scopes.
 *   Nested calls join the outer transaction. Only storage operations may be
 *   awaited inside the action.
 */
export interface StorageEngine {
  /** Opens the underlying database. Must be called before any other method. */
  initialize(): Promise<void>;

  runInTransaction<T>(scope: readonly StorageScope[], action: () => Promise<T>): Promise<T>;

  // Settings (single row)
  getSettings(): Promise<UserSettings | undefined>;
  putSettings(settings: UserSettings): Promise<void>;

  // Image cache
  getImage(key: string): Promise<ImageCacheRecord | undefined>;
  putImage(record: ImageCacheRecord): Promise<void>;
  /** Records that an image was just shown (least-recently-viewed eviction). */
  touchImage(key: string, at: string): Promise<void>;
  deleteImage(key: string): Promise<void>;
  deleteImages(keys: readonly string[]): Promise<void>;
  /**
   * Deletes those of `keys` that are still unpinned, checked in the same
   * transaction (a download may have pinned one since it was listed).
   * Returns what was deleted.
   */
  evictImages(keys: readonly string[]): Promise<StoredImageRef[]>;
  /** Removes every image, pin and downloaded-set record (files on disk are the caller's). */
  clearImageCache(): Promise<void>;
  imageCacheUsage(): Promise<ImageCacheUsage>;
  /** Up to `limit` unpinned images, least recently viewed first. */
  listEvictableImages(limit: number): Promise<StoredImageRef[]>;
  /** Removes every unpinned image, returning what was removed. */
  deleteUnpinnedImages(): Promise<StoredImageRef[]>;

  // Image pins (images kept for offline use by downloaded sets)
  pinImages(setKey: string, imageKeys: readonly string[]): Promise<void>;
  /** Removes a set's pins; its images become evictable unless another set pins them. */
  unpinSet(setKey: string): Promise<void>;
  /** Downloaded sets with how many of their pinned images are stored, and their size. */
  listPinnedSets(): Promise<PinnedSetSummary[]>;

  // Downloaded sets (what was downloaded, in which languages)
  putDownloadedSet(record: DownloadedSet): Promise<void>;
  listDownloadedSets(): Promise<DownloadedSet[]>;
  deleteDownloadedSet(setKey: string): Promise<void>;

  // Sync metadata
  getSyncMeta(key: string): Promise<SyncMetaEntry | undefined>;
  putSyncMeta(entry: SyncMetaEntry): Promise<void>;

  // Card catalog (read-only reference data; never in the outbox)
  /** Makes the stored series exactly `series` (all regions). */
  replaceCatalogSeries(series: readonly CatalogSeries[]): Promise<void>;
  listCatalogSeries(): Promise<CatalogSeries[]>;
  /**
   * Stores a downloaded set: its row, its cards and their search rows replace
   * any earlier copy, atomically.
   */
  replaceCatalogSet(pack: CatalogSetPack): Promise<void>;
  /** Removes a set, its cards and their search rows. */
  deleteCatalogSet(region: CatalogRegion, setId: string): Promise<void>;
  /** All stored sets, or one region's. */
  listCatalogSets(region?: CatalogRegion): Promise<StoredCatalogSet[]>;
  /** One stored set. */
  getCatalogSet(region: CatalogRegion, setId: string): Promise<StoredCatalogSet | undefined>;
  /** A set's cards in display order. */
  listCatalogCards(region: CatalogRegion, setId: string): Promise<CatalogCard[]>;
  getCatalogCard(region: CatalogRegion, cardId: string): Promise<CatalogCard | undefined>;
  /** Cards by `region:id` key, in the order given; keys not stored are skipped. */
  getCatalogCardsByKey(keys: readonly string[]): Promise<CatalogCard[]>;
  catalogStats(): Promise<CatalogStats>;
  /** One catalog's search rows. */
  listCatalogSearchRows(region: CatalogRegion): Promise<CatalogSearchRow[]>;
  /** Rebuilds a stored set's search rows from its cards (after the row format changes). */
  reindexCatalogSet(region: CatalogRegion, setId: string): Promise<void>;

  // Collection (docs/collection.md), keyed by `collectionEntryId`
  /** Inserts or replaces the entry with its `collectionEntryId`. */
  putCollectionEntry(entry: CollectionEntry): Promise<void>;
  deleteCollectionEntry(key: string): Promise<void>;
  listCollectionEntries(): Promise<CollectionEntry[]>;

  // Outbox
  getOutboxEntry(opId: string): Promise<OutboxEntry | undefined>;
  listOutboxOrderedByCreatedAt(): Promise<OutboxEntry[]>;
  putOutboxEntry(entry: OutboxEntry): Promise<void>;
  bulkDeleteOutbox(opIds: string[]): Promise<void>;
  clearOutbox(): Promise<void>;
}

export const STORAGE_ENGINE = new InjectionToken<StorageEngine>('STORAGE_ENGINE');

/**
 * Thrown when a nested `runInTransaction` asks for a scope the enclosing
 * transaction doesn't cover. Both engines reject this identically: IndexedDB
 * can't widen a running transaction, so SQLite (which could) refuses too,
 * keeping web and native behavior in step.
 */
export class NestedTransactionScopeError extends Error {
  override readonly name = 'NestedTransactionScopeError';

  constructor(missing: readonly StorageScope[]) {
    super(
      `Nested runInTransaction needs scope(s) not covered by the outer transaction: ${missing.join(', ')}`
    );
  }
}

/** Returns the error to reject with when `inner` isn't covered by `outer`, else null. */
export function nestedScopeViolation(
  outer: ReadonlySet<StorageScope>,
  inner: readonly StorageScope[]
): NestedTransactionScopeError | null {
  const missing = inner.filter((scope) => !outer.has(scope));
  return missing.length > 0 ? new NestedTransactionScopeError(missing) : null;
}
