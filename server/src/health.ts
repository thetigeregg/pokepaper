import type { FastifyInstance } from 'fastify';
import { clientIp } from './client-ip.js';
import type { Db } from './db.js';

/**
 * `GET /api/health`: 200 when the database answers, 503 otherwise. Used by
 * the compose healthcheck.
 *
 * Also reports `clientIp`, the address this request is rate-limited as
 * (before IPv6 addresses are grouped by /64). It only ever echoes the
 * caller's own address. Fetched through the public URL,
 * it should be the visitor's real public IP; a proxy or gateway address means
 * the proxy chain isn't trusted correctly (docs/nas-deployment.md, section 4).
 */
export function registerHealthRoute(
  app: FastifyInstance,
  db: Db,
  clientIpHeader: string | null
): void {
  app.get('/api/health', { config: { auth: 'public' } }, (request, reply) => {
    try {
      db.prepare('SELECT 1').get();
      return { status: 'ok', clientIp: clientIp(request, clientIpHeader) };
    } catch (error: unknown) {
      request.log.error({ err: error }, 'health.database_unavailable');
      return reply.status(503).send({ status: 'unavailable' });
    }
  });
}
