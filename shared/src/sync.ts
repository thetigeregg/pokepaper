/**
 * Wire contract for local-first sync between the app and the server.
 *
 * Clients queue writes in a local outbox and push them in order; the server
 * applies each operation at most once (keyed by `opId`) and appends it to a
 * change log. Clients then pull the change log from their last cursor.
 *
 * Operations carry full entity state (never partial patches), so the newest
 * operation per entity supersedes older ones. New syncable entities
 * (collection entries, decks, …) extend `SyncEntityType`; the envelope stays
 * the same. Conflict rules and server requirements: docs/sync.md.
 */
export type SyncEntityType = 'settings';

export type SyncOperation = 'upsert' | 'delete';

export interface SyncOperationRequest {
  /** Client-generated UUID; makes push idempotent across retries. */
  opId: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  /** Full entity for `upsert`; `null` for `delete`. */
  payload: unknown;
  clientTimestamp: string;
}

export interface SyncPushRequest {
  operations: SyncOperationRequest[];
}

export type SyncPushStatus = 'applied' | 'duplicate' | 'failed';

export interface SyncPushResult {
  opId: string;
  status: SyncPushStatus;
  message?: string;
}

export interface SyncPushResponse {
  results: SyncPushResult[];
}

export interface SyncPullRequest {
  /** Opaque cursor from the previous pull; omit (or `'0'`) for a full pull. */
  cursor?: string;
}

export interface SyncChange {
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  payload: unknown;
  serverTimestamp: string;
}

export interface SyncPullResponse {
  cursor: string;
  changes: SyncChange[];
  /** True when more changes remain past `cursor`; clients pull again. */
  hasMore: boolean;
}
