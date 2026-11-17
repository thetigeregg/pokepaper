import type {
  SyncChange,
  SyncEntityType,
  SyncOperation,
  SyncOperationRequest,
  SyncPullResponse,
  SyncPushResult,
} from '@pokepaper/shared';
import type { Db } from '../db.js';
import { rejectionReason } from './validation.js';

export const PULL_PAGE_SIZE = 500;

interface AppliedOperationRow {
  status: 'applied' | 'failed';
  message: string | null;
}

interface EntityChangeRow {
  seq: number;
  entity_type: SyncEntityType;
  entity_id: string;
  operation: SyncOperation;
  payload: string | null;
  client_timestamp: string;
  server_timestamp: string;
}

/**
 * Server side of local-first sync (contract: docs/sync.md).
 *
 * Push is idempotent per opId and last-writer-wins per entity by
 * clientTimestamp. Every applied write replaces the entity's row in
 * `entity_changes` with a fresh `seq`, which is both the current state and a
 * compacted change log for pulls.
 */
export class SyncStore {
  constructor(private readonly db: Db) {}

  /** Applies a batch atomically and returns one result per operation, in order. */
  push(operations: SyncOperationRequest[]): SyncPushResult[] {
    const findProcessed = this.db.prepare<[string], AppliedOperationRow>(
      'SELECT status, message FROM applied_operations WHERE op_id = ?'
    );
    const recordProcessed = this.db.prepare(
      'INSERT INTO applied_operations (op_id, status, message, processed_at) VALUES (?, ?, ?, ?)'
    );
    const findEntity = this.db.prepare<[string, string], { client_timestamp: string }>(
      'SELECT client_timestamp FROM entity_changes WHERE entity_type = ? AND entity_id = ?'
    );
    const deleteEntity = this.db.prepare(
      'DELETE FROM entity_changes WHERE entity_type = ? AND entity_id = ?'
    );
    const insertEntity = this.db.prepare(
      `INSERT INTO entity_changes
         (entity_type, entity_id, operation, payload, client_timestamp, server_timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    const run = this.db.transaction((ops: SyncOperationRequest[]): SyncPushResult[] =>
      ops.map((op) => {
        const processed = findProcessed.get(op.opId);
        if (processed) {
          // A permanent rejection stays rejected; a repeat of an applied op is a duplicate.
          return processed.status === 'failed'
            ? { opId: op.opId, status: 'failed', message: processed.message ?? undefined }
            : { opId: op.opId, status: 'duplicate' };
        }

        const now = new Date().toISOString();
        const reason = rejectionReason(op);
        if (reason) {
          recordProcessed.run(op.opId, 'failed', reason, now);
          return { opId: op.opId, status: 'failed', message: reason };
        }

        const current = findEntity.get(op.entityType, op.entityId);
        const isStale =
          current !== undefined &&
          Date.parse(op.clientTimestamp) < Date.parse(current.client_timestamp);

        // A stale op is acknowledged as applied but changes nothing: a newer
        // write for this entity already won.
        if (!isStale) {
          deleteEntity.run(op.entityType, op.entityId);
          insertEntity.run(
            op.entityType,
            op.entityId,
            op.operation,
            op.operation === 'upsert' ? JSON.stringify(op.payload) : null,
            op.clientTimestamp,
            now
          );
        }

        recordProcessed.run(op.opId, 'applied', null, now);
        return { opId: op.opId, status: 'applied' };
      })
    );

    return run(operations);
  }

  /**
   * Returns up to `pageSize` changes after `cursor` (a stringified seq;
   * `'0'` = from the start).
   *
   * A cursor beyond the newest seq this database has ever issued means the
   * client synced against data this server no longer has (e.g. after
   * restoring an older backup). The response then rewinds the client to
   * `'0'` with `hasMore`, so it immediately re-pulls everything.
   */
  pull(cursor: number, pageSize: number = PULL_PAGE_SIZE): SyncPullResponse {
    const highestIssued =
      this.db
        .prepare<[], { seq: number }>(
          "SELECT seq FROM sqlite_sequence WHERE name = 'entity_changes'"
        )
        .get()?.seq ?? 0;
    if (cursor > highestIssued) {
      return { cursor: '0', changes: [], hasMore: true };
    }

    const rows = this.db
      .prepare<[number, number], EntityChangeRow>(
        `SELECT seq, entity_type, entity_id, operation, payload, client_timestamp, server_timestamp
         FROM entity_changes WHERE seq > ? ORDER BY seq LIMIT ?`
      )
      .all(cursor, pageSize + 1);

    const page = rows.slice(0, pageSize);
    const changes: SyncChange[] = page.map((row) => ({
      entityType: row.entity_type,
      entityId: row.entity_id,
      operation: row.operation,
      payload: row.payload === null ? null : (JSON.parse(row.payload) as unknown),
      serverTimestamp: row.server_timestamp,
    }));

    const last = page.at(-1);
    return {
      cursor: String(last ? last.seq : cursor),
      changes,
      hasMore: rows.length > pageSize,
    };
  }
}
