import type {
  SyncChange,
  SyncEntityType,
  SyncOperation,
  SyncPullResponse,
  SyncPushResult,
} from '@pokepaper/shared';
import type { Statement } from 'better-sqlite3';
import type { Db } from '../db.js';
import { type RawOperation, validateOperation } from './validation.js';

export const PULL_PAGE_SIZE = 500;

interface EntityChangeRow {
  seq: number;
  entity_type: SyncEntityType;
  entity_id: string;
  operation: SyncOperation;
  payload: string | null;
  client_timestamp: string;
  server_timestamp: string;
}

type CurrentRow = Pick<EntityChangeRow, 'operation' | 'payload' | 'client_timestamp'>;

const CURSOR = /^([0-9a-f]{1,32}):(0|[1-9][0-9]{0,15})$/;

/**
 * Server side of local-first sync (contract: docs/sync.md).
 *
 * Push is idempotent per opId and last-writer-wins per entity by
 * clientTimestamp. Every write, including the echo of a winning value when a
 * stale op loses, replaces the entity's row in `entity_changes` with a fresh
 * `seq`, which is both the current state and a compacted change log.
 *
 * Cursors are `<epoch>:<seq>`. The epoch identifies this physical database;
 * backup snapshots get a new one, so a restored database never matches a
 * client's cursor and the client is rewound to a full re-pull.
 */
export class SyncStore {
  private readonly epoch: string;
  private readonly findApplied: Statement<[string], { op_id: string }>;
  private readonly recordApplied: Statement<[string, string]>;
  private readonly findEntity: Statement<[string, string], CurrentRow>;
  private readonly writeEntity: Statement<[string, string, string, string | null, string, string]>;
  private readonly selectPage: Statement<[number, number], EntityChangeRow>;
  private readonly highestIssued: Statement<[], { seq: number }>;

  constructor(private readonly db: Db) {
    const epochRow = db
      .prepare<[], { value: string }>("SELECT value FROM server_meta WHERE key = 'epoch'")
      .get();
    if (!epochRow) {
      throw new Error('server_meta.epoch is missing; was the database migrated?');
    }
    this.epoch = epochRow.value;

    this.findApplied = db.prepare('SELECT op_id FROM applied_operations WHERE op_id = ?');
    this.recordApplied = db.prepare(
      'INSERT INTO applied_operations (op_id, processed_at) VALUES (?, ?)'
    );
    this.findEntity = db.prepare(
      `SELECT operation, payload, client_timestamp FROM entity_changes
       WHERE entity_type = ? AND entity_id = ?`
    );
    // REPLACE deletes the entity's old row (UNIQUE conflict) and inserts a new
    // one, so AUTOINCREMENT assigns a fresh, never-reused seq.
    this.writeEntity = db.prepare(
      `INSERT OR REPLACE INTO entity_changes
         (entity_type, entity_id, operation, payload, client_timestamp, server_timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    this.selectPage = db.prepare(
      `SELECT seq, entity_type, entity_id, operation, payload, client_timestamp, server_timestamp
       FROM entity_changes WHERE seq > ? ORDER BY seq LIMIT ?`
    );
    this.highestIssued = db.prepare(
      "SELECT seq FROM sqlite_sequence WHERE name = 'entity_changes'"
    );
  }

  /** Applies a batch atomically and returns one result per operation, in order. */
  push(operations: RawOperation[]): SyncPushResult[] {
    return this.db.transaction((ops: RawOperation[]) => ops.map((op) => this.applyOne(op)))(
      operations
    );
  }

  private applyOne(raw: RawOperation): SyncPushResult {
    if (this.findApplied.get(raw.opId)) {
      return { opId: raw.opId, status: 'duplicate' };
    }

    const validated = validateOperation(raw);
    if (!validated.ok) {
      const { message, retryable } = validated.rejection;
      return retryable
        ? { opId: raw.opId, status: 'failed', message, retryable: true }
        : { opId: raw.opId, status: 'failed', message };
    }

    const { op } = validated;
    const now = new Date().toISOString();
    const current = this.findEntity.get(op.entityType, op.entityId);
    const isStale =
      current !== undefined &&
      Date.parse(op.clientTimestamp) < Date.parse(current.client_timestamp);

    if (isStale) {
      // A newer write already won. The sender may have skipped that winning
      // change in an earlier pull (it had this op queued), so re-issue the
      // winner with a fresh seq: the sender's next pull brings it back.
      this.writeEntity.run(
        op.entityType,
        op.entityId,
        current.operation,
        current.payload,
        current.client_timestamp,
        now
      );
    } else {
      this.writeEntity.run(
        op.entityType,
        op.entityId,
        op.operation,
        op.operation === 'upsert' ? JSON.stringify(op.payload) : null,
        op.clientTimestamp,
        now
      );
    }

    this.recordApplied.run(op.opId, now);
    return { opId: op.opId, status: 'applied' };
  }

  /**
   * Returns up to `pageSize` changes after `cursor` (`'0'` = from the start).
   * Rewinds the client to `'0'` with `hasMore` when its cursor belongs to a
   * different database epoch (e.g. this database was restored from a backup)
   * or is otherwise not valid for this database.
   */
  pull(cursor: string, pageSize: number = PULL_PAGE_SIZE): SyncPullResponse {
    const afterSeq = this.resolveCursor(cursor);
    if (afterSeq === null) {
      return { cursor: '0', changes: [], hasMore: true };
    }

    const rows = this.selectPage.all(afterSeq, pageSize + 1);
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
      cursor: `${this.epoch}:${String(last ? last.seq : afterSeq)}`,
      changes,
      hasMore: rows.length > pageSize,
    };
  }

  /** The seq to read after, or null when the client must be rewound. */
  private resolveCursor(cursor: string): number | null {
    if (cursor === '0') {
      return 0;
    }

    const match = CURSOR.exec(cursor);
    if (!match || match[1] !== this.epoch) {
      return null;
    }

    const seq = Number(match[2]);
    const highest = this.highestIssued.get()?.seq ?? 0;
    return seq > highest ? null : seq;
  }
}
