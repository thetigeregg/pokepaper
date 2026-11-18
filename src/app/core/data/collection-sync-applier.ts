import { Injectable } from '@angular/core';
import { isCollectionEntry, type SyncChange } from '@pokepaper/shared';
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
    // The server validates pushes; this only guards against storing
    // something unusable if that ever slips.
    if (!isCollectionEntry(change.payload)) {
      console.error('collection.invalid_pulled_entry', change.entityId);
      return Promise.resolve();
    }
    return engine.putCollectionEntry(change.payload);
  }
}
