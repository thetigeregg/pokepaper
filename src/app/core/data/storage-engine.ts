import { InjectionToken } from '@angular/core';
import type {
  CatalogCard,
  CatalogRegion,
  CatalogSeries,
  CatalogSet,
  CatalogSetPack,
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
  | 'catalogCards';

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
 * Image cache row. The web engine persists the image bytes inline (`blob`);
 * the native engine stores bytes on the filesystem and keeps only a relative
 * file path here instead.
 */
export interface ImageCacheRecord {
  key: string;
  blob?: Blob;
  filePath?: string | null;
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
  deleteImage(key: string): Promise<void>;
  clearImageCache(): Promise<void>;

  // Sync metadata
  getSyncMeta(key: string): Promise<SyncMetaEntry | undefined>;
  putSyncMeta(entry: SyncMetaEntry): Promise<void>;

  // Card catalog (read-only reference data; never in the outbox)
  /** Makes the stored series exactly `series` (all regions). */
  replaceCatalogSeries(series: readonly CatalogSeries[]): Promise<void>;
  listCatalogSeries(): Promise<CatalogSeries[]>;
  /** Stores a downloaded set: its row and its cards replace any earlier copy, atomically. */
  replaceCatalogSet(pack: CatalogSetPack): Promise<void>;
  /** Removes a set and its cards. */
  deleteCatalogSet(region: CatalogRegion, setId: string): Promise<void>;
  /** All stored sets, or one region's. */
  listCatalogSets(region?: CatalogRegion): Promise<StoredCatalogSet[]>;
  /** A set's cards in display order. */
  listCatalogCards(region: CatalogRegion, setId: string): Promise<CatalogCard[]>;
  getCatalogCard(region: CatalogRegion, cardId: string): Promise<CatalogCard | undefined>;
  catalogStats(): Promise<CatalogStats>;

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
