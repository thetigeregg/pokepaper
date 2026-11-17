import type { ClientKind } from '@pokepaper/shared';
import type {} from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ResolvedSession } from './store.js';

/**
 * `__Host-` prefix: the browser only accepts it with Secure, Path=/ and no
 * Domain, so it can't be set or overwritten by any other host.
 */
export const SESSION_COOKIE = '__Host-pokepaper_session';

export interface RequestSession extends ResolvedSession {
  via: 'cookie' | 'bearer' | 'dev-bypass';
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth hook on authenticated routes. */
    session: RequestSession | null;
  }
  interface FastifyContextConfig {
    /** `public` routes skip the session requirement (they may still read an optional session). */
    auth?: 'public';
  }
}

/** The bearer token (iOS) or session cookie (web) on a request, if any. */
export function readSessionToken(
  request: FastifyRequest
): { token: string; via: 'cookie' | 'bearer' } | null {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    return token ? { token, via: 'bearer' } : null;
  }

  const cookie = request.cookies[SESSION_COOKIE];
  return cookie ? { token: cookie, via: 'cookie' } : null;
}

export function setSessionCookie(reply: FastifyReply, token: string, ttlDays: number): void {
  void reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: ttlDays * 24 * 60 * 60,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  void reply.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
  });
}

/**
 * Hands a new session to the client: an httpOnly cookie for web, the token
 * in the response body for iOS (stored in the Keychain).
 */
export function issueSession(
  reply: FastifyReply,
  client: ClientKind,
  token: string,
  ttlDays: number
): { token?: string } {
  if (client === 'ios') {
    return { token };
  }
  setSessionCookie(reply, token, ttlDays);
  return {};
}
