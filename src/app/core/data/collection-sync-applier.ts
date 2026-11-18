import { Injectable } from '@angular/core';
import {
  collectionEntry,
  collectionEntryId,
  isCollectionEntry,
  type SyncChange,
} from '@pokepaper/shared';
import type { StorageEngine } from './storage-engine';
import type { SyncEntityApplier } from './sync-entity-applier';

/** Applies pulled `collectionEntry` changes (docs/collection.md). */
@Injectable({ providedIn: 'root' })
export class CollectionSyncApplier implements SyncEntityApplier {
  readonly entityType = 'collectionEntry' as const;
  readonly scopes = ['collection'] as const;

  apply(engine: StorageEngine, change: SyncChange): Promise<void> {
    if (change.operation === 'delete') {
      return engine.deleteCollectionEntry(change.entityId);
    }
    // The server checks pushes, so this only happens if its rules ever get
    // looser than this build's. Removing the row keeps a stale count from
    // showing; the server still has the entry.
    if (
      !isCollectionEntry(change.payload) ||
      collectionEntryId(change.payload) !== change.entityId
    ) {
      console.error('collection.unusable_pulled_entry', change.entityId);
      return engine.deleteCollectionEntry(change.entityId);
    }
    return engine.putCollectionEntry(collectionEntry(change.payload, change.payload.quantity));
  }
}
