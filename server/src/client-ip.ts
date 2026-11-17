import type { FastifyRequest } from 'fastify';

const MAX_IP_LENGTH = 45;

/**
 * The client IP the server keys rate limits on: the configured client-IP
 * header (in production Cloudflare's `cf-connecting-ip`, which edge only
 * passes through from trusted proxies) or, failing that, the connection's
 * address after `trustProxyHops`.
 */
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
