import type { FastifyInstance } from 'fastify';
import type { Db } from './db.js';

/** `GET /api/health`: 200 when the database answers, 503 otherwise. Used by the compose healthcheck. */
export function registerHealthRoute(app: FastifyInstance, db: Db): void {
  app.get('/api/health', (request, reply) => {
    try {
      db.prepare('SELECT 1').get();
      return { status: 'ok' };
    } catch (error: unknown) {
      request.log.error({ err: error }, 'health.database_unavailable');
      return reply.status(503).send({ status: 'unavailable' });
    }
  });
}
