import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from './db.js';
import { registerHealthRoute } from './health.js';
import { registerSyncRoutes } from './sync/routes.js';
import { SyncStore } from './sync/store.js';

export interface BuildAppOptions {
  db: Db;
  trustProxy?: boolean;
  /** `false` silences logging (tests); otherwise a pino level such as `info`. */
  logLevel?: string | false;
}

/**
 * Builds the Fastify app without listening, so tests can drive it with
 * `app.inject()` against an in-memory database.
 */
export function buildApp({
  db,
  trustProxy = false,
  logLevel = 'info',
}: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: logLevel === false ? false : { level: logLevel },
    trustProxy,
    bodyLimit: 5 * 1024 * 1024,
  });

  registerHealthRoute(app, db);
  registerSyncRoutes(app, new SyncStore(db));

  return app;
}
