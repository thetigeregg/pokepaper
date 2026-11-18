import {
  collectionEntryId,
  isCollectionEntry,
  isCollectionEntryId,
  isSyncEntityType,
  isUserSettings,
  SETTINGS_ENTITY_ID,
  type SyncEntityType,
  type SyncOperationRequest,
} from '@pokepaper/shared';

const MAX_ENTITY_ID_LENGTH = 200;

/**
 * The exact UTC form `Date.prototype.toISOString()` produces (what clients
 * send). Strict on purpose: last-writer-wins compares these timestamps, so
 * zone-less or loosely parsed values would make the outcome depend on the
 * server's time zone.
 */
const ISO_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

interface EntityRules {
  validEntityId(entityId: string): boolean;
  /** Checks an upsert's payload, which must also agree with its (already valid) entity ID. */
  validPayload(payload: unknown, entityId: string): boolean;
}

/** Per-entity validation. Adding a `SyncEntityType` without rules here fails type-checking. */
const ENTITY_RULES: Record<SyncEntityType, EntityRules> = {
  settings: {
    validEntityId: (entityId) => entityId === SETTINGS_ENTITY_ID,
    validPayload: isUserSettings,
  },
  collectionEntry: {
    validEntityId: isCollectionEntryId,
    validPayload: (payload, entityId) =>
      isCollectionEntry(payload) && collectionEntryId(payload) === entityId,
  },
};

export interface Rejection {
  message: string;
  /** True when a newer server may accept the op unchanged (see SyncPushResult.retryable). */
  retryable: boolean;
}

export type ValidationResult =
  { ok: true; op: SyncOperationRequest } | { ok: false; rejection: Rejection };

/**
 * An operation as received: the route schema only guarantees a string opId,
 * so every other field is unknown until validated.
 */
export type RawOperation = { readonly opId: string } & Partial<
  Record<Exclude<keyof SyncOperationRequest, 'opId'>, unknown>
>;

function reject(message: string, retryable = false): ValidationResult {
  return { ok: false, rejection: { message, retryable } };
}

export function isIsoUtcTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' && ISO_UTC_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value))
  );
}

/**
 * Validates one pushed operation. The request schema only guarantees an
 * object with a string `opId`; every other field is checked here so a single
 * bad operation fails on its own instead of failing the whole push.
 */
export function validateOperation(raw: RawOperation): ValidationResult {
  const { entityType, entityId, operation, payload, clientTimestamp } = raw;

  if (typeof entityType !== 'string' || entityType.length === 0) {
    return reject('entityType must be a non-empty string');
  }

  if (!isSyncEntityType(entityType)) {
    // A newer client may know entity types this server doesn't yet.
    return reject(`Unknown entity type "${entityType}"`, true);
  }

  if (
    typeof entityId !== 'string' ||
    entityId.length === 0 ||
    entityId.length > MAX_ENTITY_ID_LENGTH
  ) {
    return reject(`entityId must be a string of 1-${String(MAX_ENTITY_ID_LENGTH)} characters`);
  }

  const rules = ENTITY_RULES[entityType];
  if (!rules.validEntityId(entityId)) {
    return reject(`Invalid entityId "${entityId}" for ${entityType}`);
  }

  if (operation !== 'upsert' && operation !== 'delete') {
    return reject('operation must be "upsert" or "delete"');
  }

  if (!isIsoUtcTimestamp(clientTimestamp)) {
    return reject('clientTimestamp must be a UTC ISO 8601 timestamp like 2026-01-01T00:00:00.000Z');
  }

  if (operation === 'upsert' && !rules.validPayload(payload, entityId)) {
    return reject(`Invalid ${entityType} payload`);
  }

  return {
    ok: true,
    op: {
      opId: raw.opId,
      entityType,
      entityId,
      operation,
      payload: operation === 'upsert' ? payload : null,
      clientTimestamp,
    },
  };
}
