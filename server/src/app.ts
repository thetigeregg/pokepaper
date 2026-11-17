import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { Db } from './db.js';
import { registerHealthRoute } from './health.js';
import { registerSyncRoutes } from './sync/routes.js';
import { SyncStore } from './sync/store.js';

export const DEFAULT_RATE_LIMIT_PER_MINUTE = 600;
const MAX_IP_LENGTH = 45;

export interface BuildAppOptions {
  db: Db;
  /** Reverse proxies whose X-Forwarded-* headers to trust (see ServerConfig.trustProxyHops). */
  trustProxyHops?: number;
  /** Header with the real client IP (see ServerConfig.clientIpHeader). */
  clientIpHeader?: string | null;
  /** `false` silences logging (tests); otherwise a pino level such as `info`. */
  logLevel?: string | false;
  /** Requests per client IP per minute, across all routes. */
  rateLimitPerMinute?: number;
}

/** The client IP used to key rate limits. */
export function clientIp(request: FastifyRequest, clientIpHeader: string | null): string {
  if (clientIpHeader) {
    const raw = request.headers[clientIpHeader];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (value && value.length <= MAX_IP_LENGTH) {
      return value;
    }
  }

  return request.ip;
}

/**
 * Builds the Fastify app without listening, so tests can drive it with
 * `app.inject()` against an in-memory database.
 */
export function buildApp({
  db,
  trustProxyHops = 0,
  clientIpHeader = null,
  logLevel = 'info',
  rateLimitPerMinute = DEFAULT_RATE_LIMIT_PER_MINUTE,
}: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: logLevel === false ? false : { level: logLevel },
    // Trust only the nearest `trustProxyHops` proxies (0 = none, so request.ip
    // is the socket peer). Same as Fastify's numeric option, which its typings
    // don't accept.
    trustProxy: (_address: string, hop: number) => hop < trustProxyHops,
    bodyLimit: 5 * 1024 * 1024,
  });

  // The server is reachable from the public internet, so every route is
  // limited per client IP. The limit is generous: a single user syncing every
  // 30s, plus the compose healthcheck, stays far below it. Stricter limits for
  // auth routes come with passkey auth.
  void app.register(rateLimit, {
    global: true,
    max: rateLimitPerMinute,
    timeWindow: '1 minute',
    keyGenerator: (request) => clientIp(request, clientIpHeader),
  });

  // Registered as a plugin so avvio loads it after rate-limit, whose
  // onRoute hook must see every route.
  void app.register((instance, _options, done) => {
    registerHealthRoute(instance, db);
    registerSyncRoutes(instance, new SyncStore(db));
    done();
  });

  return app;
}
