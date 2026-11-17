import type { SyncPullRequest } from '@pokepaper/shared';
import type { FastifyInstance } from 'fastify';
import type { SyncStore } from './store.js';
import type { RawOperation } from './validation.js';

/** Max operations accepted per push (the client sends batches of 200). */
export const MAX_PUSH_OPERATIONS = 500;

/**
 * Deliberately minimal: only what's needed to answer per operation (an
 * object with a string opId). All other field checks happen per operation in
 * validation.ts, so one bad operation becomes a `failed` result instead of a
 * 400 that would block every push containing it.
 */
const pushBodySchema = {
  type: 'object',
  required: ['operations'],
  properties: {
    operations: {
      type: 'array',
      maxItems: MAX_PUSH_OPERATIONS,
      items: {
        type: 'object',
        required: ['opId'],
        properties: {
          opId: { type: 'string', minLength: 1, maxLength: 200 },
        },
      },
    },
  },
} as const;

const pullBodySchema = {
  type: 'object',
  properties: {
    cursor: { type: 'string', maxLength: 64 },
  },
} as const;

/**
 * `POST /api/sync/push` and `POST /api/sync/pull` (contract: docs/sync.md).
 * The cursor is opaque to clients; an unrecognized one rewinds the client to
 * a full re-pull rather than failing.
 */
export function registerSyncRoutes(app: FastifyInstance, store: SyncStore): void {
  app.post<{ Body: { operations: RawOperation[] } }>(
    '/api/sync/push',
    { schema: { body: pushBodySchema } },
    (request) => ({ results: store.push(request.body.operations) })
  );

  app.post<{ Body: SyncPullRequest }>(
    '/api/sync/pull',
    { schema: { body: pullBodySchema } },
    (request) => store.pull(request.body.cursor ?? '0')
  );
}
