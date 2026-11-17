import { InjectionToken } from '@angular/core';
import type { OutboxEntry } from './storage-engine';

/**
 * Lets repositories trigger a sync attempt right after enqueueing a write,
 * without depending directly on `SyncService` (ported from go-gather /
 * game-shelf). Repositories build and store outbox entries themselves,
 * inside the same transaction as the domain write. Optional: if nothing
 * provides this token, writes are still queued in the outbox, they just
 * aren't proactively pushed until the next scheduled sync.
 */
export interface SyncOutboxWriter {
  syncNow?(): Promise<void>;
  onOutboxEntryEnqueued?(entry: OutboxEntry): void;
}

export const SYNC_OUTBOX_WRITER = new InjectionToken<SyncOutboxWriter>('SYNC_OUTBOX_WRITER');
