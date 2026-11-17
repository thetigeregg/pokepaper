import type { SyncPullRequest, SyncPushRequest } from '@pokepaper/shared';
import type { FastifyInstance } from 'fastify';
import { SyncStore } from './store.js';

/** Max operations accepted per push (the client sends batches of 200). */
export const MAX_PUSH_OPERATIONS = 500;

const pushBodySchema = {
  type: 'object',
  required: ['operations'],
  additionalProperties: false,
  properties: {
    operations: {
      type: 'array',
      maxItems: MAX_PUSH_OPERATIONS,
      items: {
        type: 'object',
        required: ['opId', 'entityType', 'entityId', 'operation', 'payload', 'clientTimestamp'],
        additionalProperties: false,
        properties: {
          opId: { type: 'string', minLength: 1, maxLength: 100 },
          entityType: { type: 'string', minLength: 1, maxLength: 50 },
          entityId: { type: 'string', maxLength: 200 },
          operation: { type: 'string', enum: ['upsert', 'delete'] },
          payload: {},
          clientTimestamp: { type: 'string', minLength: 1, maxLength: 40 },
        },
      },
    },
  },
} as const;

const pullBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cursor: { type: 'string', pattern: '^(0|[1-9][0-9]{0,15})$' },
  },
} as const;

/**
 * `POST /api/sync/push` and `POST /api/sync/pull` (contract: docs/sync.md).
 * Malformed bodies are a 400 (schema validation; unknown properties are
 * stripped, per Fastify's default `removeAdditional`). Individually invalid
 * operations come back as `failed` results instead.
 */
export function registerSyncRoutes(app: FastifyInstance, store: SyncStore): void {
  app.post<{ Body: SyncPushRequest }>(
    '/api/sync/push',
    { schema: { body: pushBodySchema } },
    (request) => ({ results: store.push(request.body.operations) })
  );

  app.post<{ Body: SyncPullRequest }>(
    '/api/sync/pull',
    { schema: { body: pullBodySchema } },
    (request) => store.pull(Number(request.body.cursor ?? '0'))
  );
}
