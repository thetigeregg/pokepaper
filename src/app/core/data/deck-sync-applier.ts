import { Injectable } from '@angular/core';
import { deck, isDeck, type SyncChange } from '@pokepaper/shared';
import type { StorageEngine } from './storage-engine';
import type { SyncEntityApplier } from './sync-entity-applier';

/** Applies pulled `deck` changes (docs/decks.md). */
@Injectable({ providedIn: 'root' })
export class DeckSyncApplier implements SyncEntityApplier {
  readonly entityType = 'deck' as const;
  readonly scopes = ['decks'] as const;

  apply(engine: StorageEngine, change: SyncChange): Promise<void> {
    if (change.operation === 'delete') {
      return engine.deleteDeck(change.entityId);
    }
    // The server checks pushes, so this only happens if its rules ever get
    // looser than this build's. Removing the row keeps a deck this build
    // can't edit safely from showing; the server still has it.
    if (!isDeck(change.payload) || change.payload.id !== change.entityId) {
      console.error('deck.unusable_pulled_deck', change.entityId);
      return engine.deleteDeck(change.entityId);
    }
    return engine.putDeck(deck(change.payload));
  }
}
