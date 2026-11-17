import { InjectionToken } from '@angular/core';
import type { SyncChange, SyncEntityType } from '@pokepaper/shared';
import type { StorageEngine, StorageScope } from './storage-engine';

/**
 * Applies pulled server changes for one entity type to local storage.
 *
 * `SyncService` runs `apply` inside a transaction over `scopes` + `syncMeta`,
 * so a page of changes commits atomically together with the advanced pull
 * cursor. Each syncable entity registers one applier via
 * `{ provide: SYNC_ENTITY_APPLIERS, useClass: …, multi: true }`.
 */
export interface SyncEntityApplier {
  readonly entityType: SyncEntityType;
  readonly scopes: readonly StorageScope[];
  apply(engine: StorageEngine, change: SyncChange): Promise<void>;
}

export const SYNC_ENTITY_APPLIERS = new InjectionToken<readonly SyncEntityApplier[]>(
  'SYNC_ENTITY_APPLIERS'
);
