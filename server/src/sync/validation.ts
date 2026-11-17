import {
  isSyncEntityType,
  isUserSettings,
  SETTINGS_ENTITY_ID,
  type SyncEntityType,
  type SyncOperationRequest,
} from '@pokepaper/shared';

const MAX_ENTITY_ID_LENGTH = 200;

interface EntityRules {
  validEntityId(entityId: string): boolean;
  validPayload(payload: unknown): boolean;
}

/** Per-entity validation. Adding a `SyncEntityType` without rules here fails type-checking. */
const ENTITY_RULES: Record<SyncEntityType, EntityRules> = {
  settings: {
    validEntityId: (entityId) => entityId === SETTINGS_ENTITY_ID,
    validPayload: isUserSettings,
  },
};

/**
 * Returns why an operation must be permanently rejected, or null if it's
 * valid. Only deterministic problems belong here: the client gives up on an
 * op after repeated `failed` results.
 */
export function rejectionReason(op: SyncOperationRequest): string | null {
  if (!isSyncEntityType(op.entityType)) {
    return `Unknown entity type "${String(op.entityType)}"`;
  }

  if (op.entityId.length === 0 || op.entityId.length > MAX_ENTITY_ID_LENGTH) {
    return 'entityId must be 1-200 characters';
  }

  const rules = ENTITY_RULES[op.entityType];
  if (!rules.validEntityId(op.entityId)) {
    return `Invalid entityId "${op.entityId}" for ${op.entityType}`;
  }

  if (Number.isNaN(Date.parse(op.clientTimestamp))) {
    return 'clientTimestamp must be an ISO 8601 timestamp';
  }

  if (op.operation === 'upsert' && !rules.validPayload(op.payload)) {
    return `Invalid ${op.entityType} payload`;
  }

  return null;
}
