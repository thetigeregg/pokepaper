import type {
  CredentialSummary,
  LoginVerifyRequest,
  RegisterOptionsRequest,
  RegisterVerifyRequest,
  SessionSummary,
} from '@pokepaper/shared';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthConfig } from '../config.js';
import { AuthError } from './errors.js';
import { PasskeyService } from './passkeys.js';
import {
  clearSessionCookie,
  issueSession,
  readSessionToken,
  type RequestSession,
  setSessionCookie,
} from './session-http.js';
import { readSetupToken, setupTokenMatches } from './setup-token.js';
import type { AuthStore } from './store.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const DEV_BYPASS_SESSION: RequestSession = {
  id: 'dev-bypass',
  client: 'web',
  expiresAt: '9999-12-31T23:59:59.999Z',
  extended: false,
  via: 'dev-bypass',
};

const clientSchema = { type: 'string', enum: ['web', 'ios'] } as const;
const credentialResponseSchema = {
  type: 'object',
  required: ['id', 'rawId', 'response', 'type'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 1024 } },
} as const;
const idParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 1024 } },
} as const;

export interface AuthPluginOptions {
  store: AuthStore;
  config: AuthConfig;
}

/**
 * Registers the session hook and `/api/auth/*` routes. Every route in the
 * same plugin scope requires a session unless its config says
 * `auth: 'public'`. See docs/auth.md.
 */
export function registerAuth(app: FastifyInstance, { store, config }: AuthPluginOptions): void {
  const passkeys = new PasskeyService(store, config);
  const publicRateLimit = { max: config.rateLimitPerMinute, timeWindow: '1 minute' };

  app.decorateRequest('session', null);

  /**
   * Resolves the request's session (cookie or bearer) and keeps the cookie
   * in step: refreshed when the sliding expiry was just extended, cleared
   * when it no longer matches a live session. Used by the hook and by public
   * routes that read an optional session.
   */
  function sessionFor(request: FastifyRequest, reply: FastifyReply): RequestSession | null {
    if (config.devBypass) {
      return DEV_BYPASS_SESSION;
    }

    const presented = readSessionToken(request);
    if (!presented) {
      return null;
    }

    const session = store.resolveSession(presented.token);
    if (!session) {
      if (presented.via === 'cookie') {
        clearSessionCookie(reply);
      }
      return null;
    }

    if (session.extended && presented.via === 'cookie') {
      setSessionCookie(reply, presented.token, config.sessionTtlDays);
    }
    return { ...session, via: presented.via };
  }

  /**
   * Cookies ride along on cross-site requests. SameSite=Strict already blocks
   * that; as a second line of defense, a state-changing cookie request whose
   * Origin isn't the app's own is rejected. Bearer tokens are never sent
   * implicitly, so they skip this check.
   */
  function isCrossOriginCookieWrite(request: FastifyRequest, session: RequestSession): boolean {
    if (session.via !== 'cookie' || SAFE_METHODS.has(request.method)) {
      return false;
    }
    const origin = request.headers.origin;
    return origin !== undefined && origin !== config.publicOrigin;
  }

  // preParsing: after rate limiting (a route-level onRequest hook), so floods
  // of bad tokens are throttled before they cost a session lookup, and before
  // the body is read, so unauthenticated requests never get parsed.
  app.addHook('preParsing', async (request, reply, payload) => {
    if (request.routeOptions.config.auth === 'public') {
      return payload;
    }

    const session = sessionFor(request, reply);
    if (!session) {
      return reply.status(401).send({ error: 'Sign in required' });
    }
    if (isCrossOriginCookieWrite(request, session)) {
      return reply.status(403).send({ error: 'Cross-origin request rejected' });
    }

    request.session = session;
    return payload;
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof AuthError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }
    const { validation, statusCode, message } = (error ?? {}) as Partial<FastifyError>;
    if (validation) {
      return reply.status(400).send({ error: message });
    }
    // Client errors raised by Fastify itself (malformed JSON 400, body too
    // large 413, unsupported media type 415, rate limit 429, …) keep their status.
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({ error: message });
    }
    request.log.error({ err: error }, 'request.failed');
    return reply.status(500).send({ error: 'Internal server error' });
  });

  /**
   * Who may register a passkey right now: a signed-in user adding another
   * one, or (only before any passkey exists) the holder of the setup token.
   */
  function authorizeRegistration(
    request: FastifyRequest,
    reply: FastifyReply,
    setupToken: string | undefined
  ): { mode: 'add'; session: RequestSession } | { mode: 'setup' } {
    const session = sessionFor(request, reply);
    if (session) {
      if (isCrossOriginCookieWrite(request, session)) {
        throw new AuthError(403, 'Cross-origin request rejected');
      }
      return { mode: 'add', session };
    }
    if (store.hasCredentials()) {
      throw new AuthError(401, 'Sign in to add another passkey');
    }
    if (!setupTokenMatches(config, setupToken)) {
      throw new AuthError(403, 'Invalid or missing setup token');
    }
    return { mode: 'setup' };
  }

  app.get('/api/auth/status', { config: { auth: 'public' } }, (request, reply) => {
    const registered = store.hasCredentials();
    return {
      registered,
      authenticated: sessionFor(request, reply) !== null,
      setupAvailable: !registered && readSetupToken(config) !== null,
    };
  });

  app.post<{ Body: RegisterOptionsRequest }>(
    '/api/auth/register/options',
    {
      config: { auth: 'public', rateLimit: publicRateLimit },
      schema: {
        body: {
          type: 'object',
          properties: { setupToken: { type: 'string', maxLength: 512 } },
        },
      },
    },
    async (request, reply) => {
      authorizeRegistration(request, reply, request.body.setupToken);
      return passkeys.registrationOptions();
    }
  );

  app.post<{ Body: RegisterVerifyRequest }>(
    '/api/auth/register/verify',
    {
      config: { auth: 'public', rateLimit: publicRateLimit },
      schema: {
        body: {
          type: 'object',
          required: ['response', 'client'],
          properties: {
            response: credentialResponseSchema,
            setupToken: { type: 'string', maxLength: 512 },
            label: { type: 'string', maxLength: 60 },
            client: clientSchema,
          },
        },
      },
    },
    async (request, reply) => {
      const { response, setupToken, label, client } = request.body;
      const authorization = authorizeRegistration(request, reply, setupToken);
      const credential = await passkeys.verifyRegistration(
        response as RegistrationResponseJSON,
        label?.trim() || 'Passkey'
      );

      // Synchronous transaction: the "no passkey yet" check and the insert
      // can't interleave with a concurrent setup attempt.
      const result = store.transaction(() => {
        if (authorization.mode === 'setup' && store.hasCredentials()) {
          throw new AuthError(409, 'PokePaper is already set up; sign in instead');
        }
        // An authenticator that ignores excludeCredentials, or two
        // overlapping add-passkey flows, can present an existing credential.
        if (store.findCredential(credential.id)) {
          throw new AuthError(409, 'This passkey is already registered');
        }
        const summary = store.addCredential(credential);
        const token =
          authorization.mode === 'setup' ? store.createSession(client, credential.id) : null;
        return { summary, token };
      });

      const session = result.token
        ? issueSession(reply, client, result.token, config.sessionTtlDays)
        : {};
      return { credential: result.summary, ...session };
    }
  );

  app.post(
    '/api/auth/login/options',
    { config: { auth: 'public', rateLimit: publicRateLimit } },
    async () => {
      if (!store.hasCredentials()) {
        throw new AuthError(409, 'No passkey is registered yet');
      }
      return passkeys.authenticationOptions();
    }
  );

  app.post<{ Body: LoginVerifyRequest }>(
    '/api/auth/login/verify',
    {
      config: { auth: 'public', rateLimit: publicRateLimit },
      schema: {
        body: {
          type: 'object',
          required: ['response', 'client'],
          properties: { response: credentialResponseSchema, client: clientSchema },
        },
      },
    },
    async (request, reply) => {
      const { response, client } = request.body;
      const credentialId = await passkeys.verifyAuthentication(
        response as AuthenticationResponseJSON
      );
      const token = store.createSession(client, credentialId);
      return issueSession(reply, client, token, config.sessionTtlDays);
    }
  );

  app.post('/api/auth/logout', (request, reply) => {
    signOut(request, reply);
    return reply.status(204).send();
  });

  app.get('/api/auth/credentials', (): CredentialSummary[] => store.listCredentials());

  app.delete<{ Params: { id: string } }>(
    '/api/auth/credentials/:id',
    { schema: { params: idParamsSchema } },
    (request, reply) => {
      const deleted = store.transaction(() => {
        if (store.findCredential(request.params.id) && store.credentialCount() <= 1) {
          throw new AuthError(409, "You can't remove your only passkey");
        }
        return store.deleteCredential(request.params.id);
      });
      if (!deleted) {
        throw new AuthError(404, 'Passkey not found');
      }
      return reply.status(204).send();
    }
  );

  app.get('/api/auth/sessions', (request): SessionSummary[] =>
    store.listSessions(request.session?.id ?? null)
  );

  app.delete<{ Params: { id: string } }>(
    '/api/auth/sessions/:id',
    { schema: { params: idParamsSchema } },
    (request, reply) => {
      if (request.params.id === request.session?.id) {
        signOut(request, reply);
      } else if (!store.deleteSession(request.params.id)) {
        throw new AuthError(404, 'Session not found');
      }
      return reply.status(204).send();
    }
  );

  function signOut(request: FastifyRequest, reply: FastifyReply): void {
    if (request.session && request.session.via !== 'dev-bypass') {
      store.deleteSession(request.session.id);
    }
    if (request.session?.via === 'cookie') {
      clearSessionCookie(reply);
    }
  }
}
