import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from './db.js';
import { registerHealthRoute } from './health.js';
import { registerSyncRoutes } from './sync/routes.js';
import { SyncStore } from './sync/store.js';

export const DEFAULT_RATE_LIMIT_PER_MINUTE = 600;

export interface BuildAppOptions {
  db: Db;
  trustProxy?: boolean;
  /** `false` silences logging (tests); otherwise a pino level such as `info`. */
  logLevel?: string | false;
  /** Requests per client IP per minute, across all routes. */
  rateLimitPerMinute?: number;
}

/**
 * Builds the Fastify app without listening, so tests can drive it with
 * `app.inject()` against an in-memory database.
 */
export function buildApp({
  db,
  trustProxy = false,
  logLevel = 'info',
  rateLimitPerMinute = DEFAULT_RATE_LIMIT_PER_MINUTE,
}: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: logLevel === false ? false : { level: logLevel },
    trustProxy,
    bodyLimit: 5 * 1024 * 1024,
  });

  // The server is reachable from the public internet, so every route is
  // limited per client IP (request.ip honors trustProxy behind edge). The
  // limit is generous: a single user syncing every 30s, plus the compose
  // healthcheck, stays far below it. Stricter limits for auth routes come
  // with passkey auth.
  void app.register(rateLimit, { global: true, max: rateLimitPerMinute, timeWindow: '1 minute' });

  // Registered as a plugin so avvio loads it after rate-limit, whose
  // onRoute hook must see every route.
  void app.register((instance, _options, done) => {
    registerHealthRoute(instance, db);
    registerSyncRoutes(instance, new SyncStore(db));
    done();
  });

  return app;
}
