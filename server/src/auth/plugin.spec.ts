import * as webauthn from '@simplewebauthn/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { vi } from 'vitest';
import type { Db } from '../db.js';
import {
  memoryDb,
  settingsOp,
  TEST_ORIGIN,
  TEST_SETUP_TOKEN,
  testApp,
  testAuthConfig,
} from '../test-helpers.js';
import { SESSION_COOKIE } from './session-http.js';
import { AuthStore } from './store.js';

vi.mock('@simplewebauthn/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@simplewebauthn/server')>()),
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

const verifyRegistration = vi.mocked(webauthn.verifyRegistrationResponse);
const verifyAuthentication = vi.mocked(webauthn.verifyAuthenticationResponse);

/** A response body shaped like the browser's (contents are irrelevant: verification is mocked). */
function credentialResponse(id = 'cred-1') {
  return { id, rawId: id, type: 'public-key', response: {}, clientExtensionResults: {} };
}

/**
 * Mocks a successful registration that, like the real library, consumes the
 * challenge through `expectedChallenge` (so single-use is still exercised).
 */
function mockRegistrationSucceeds(challenge: () => string, id = 'cred-1') {
  verifyRegistration.mockImplementation(async (options) => {
    const expected = options.expectedChallenge;
    if (typeof expected !== 'function' || !(await expected(challenge()))) {
      throw new Error('Unexpected registration response challenge');
    }
    return {
      verified: true,
      registrationInfo: {
        credential: {
          id,
          publicKey: new Uint8Array([9, 9, 9]),
          counter: 0,
          transports: ['internal'],
        },
        credentialDeviceType: 'multiDevice',
        credentialBackedUp: true,
      },
    } as unknown as Awaited<ReturnType<typeof webauthn.verifyRegistrationResponse>>;
  });
}

function mockAuthenticationSucceeds(challenge: () => string, newCounter = 1) {
  verifyAuthentication.mockImplementation(async (options) => {
    const expected = options.expectedChallenge;
    if (typeof expected !== 'function' || !(await expected(challenge()))) {
      throw new Error('Unexpected authentication response challenge');
    }
    return {
      verified: true,
      authenticationInfo: { newCounter },
    } as unknown as Awaited<ReturnType<typeof webauthn.verifyAuthenticationResponse>>;
  });
}

function sessionCookie(response: LightMyRequestResponse) {
  return response.cookies.find((cookie) => cookie.name === SESSION_COOKIE);
}

describe('passkey auth routes', () => {
  let db: Db;
  let app: FastifyInstance;
  let lastChallenge: string;

  async function post(url: string, payload: object = {}, headers: Record<string, string> = {}) {
    const response = await app.inject({ method: 'POST', url, payload, headers });
    const body = response.body ? response.json<Record<string, unknown>>() : {};
    if (typeof body['challenge'] === 'string') {
      lastChallenge = body['challenge'];
    }
    return response;
  }

  async function setUp(client: 'web' | 'ios' = 'web') {
    await post('/api/auth/register/options', { setupToken: TEST_SETUP_TOKEN });
    mockRegistrationSucceeds(() => lastChallenge);
    return post('/api/auth/register/verify', {
      response: credentialResponse(),
      setupToken: TEST_SETUP_TOKEN,
      label: 'MacBook',
      client,
    });
  }

  async function bearerFor(): Promise<Record<string, string>> {
    const response = await setUp('ios');
    return { authorization: `Bearer ${response.json<{ token: string }>().token}` };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    db = memoryDb();
    app = testApp(db).app;
  });

  describe('status', () => {
    it('reports first-time setup availability', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/auth/status' });

      expect(response.json()).toEqual({
        registered: false,
        authenticated: false,
        setupAvailable: true,
      });
    });

    it('reports setup unavailable without a setup token', async () => {
      const noToken = testApp(memoryDb(), { auth: testAuthConfig({ setupToken: null }) }).app;

      const response = await noToken.inject({ method: 'GET', url: '/api/auth/status' });

      expect(response.json()).toMatchObject({ setupAvailable: false });
    });

    it('reports a signed-in session once set up', async () => {
      const headers = await bearerFor();

      const response = await app.inject({ method: 'GET', url: '/api/auth/status', headers });

      expect(response.json()).toEqual({
        registered: true,
        authenticated: true,
        setupAvailable: false,
      });
    });
  });

  describe('first-time setup', () => {
    it.each([
      ['no setup token', {}],
      ['a wrong setup token', { setupToken: 'wrong-token-wrong-token' }],
    ])('refuses registration options with %s', async (_label, payload) => {
      const response = await post('/api/auth/register/options', payload);

      expect(response.statusCode).toBe(403);
    });

    it('issues resident, user-verified registration options for localhost', async () => {
      const response = await post('/api/auth/register/options', { setupToken: TEST_SETUP_TOKEN });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        rp: { id: 'localhost', name: 'PokePaper' },
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        attestation: 'none',
      });
    });

    it('registers the first passkey and signs a web client in with a hardened cookie', async () => {
      const response = await setUp('web');

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        credential: expect.objectContaining({
          id: 'cred-1',
          label: 'MacBook',
          deviceType: 'multiDevice',
        }) as unknown,
      });
      expect(sessionCookie(response)).toMatchObject({
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
        path: '/',
        maxAge: 90 * 24 * 60 * 60,
      });
      expect(verifyRegistration).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedOrigin: TEST_ORIGIN,
          expectedRPID: 'localhost',
          requireUserVerification: true,
        })
      );
    });

    it('returns a bearer token (and no cookie) to iOS clients', async () => {
      const response = await setUp('ios');

      expect(response.json<{ token: string }>().token).toMatch(/^[\w-]{43}$/);
      expect(sessionCookie(response)).toBeUndefined();
    });

    it('closes setup once a passkey exists, even with the setup token', async () => {
      await setUp();

      const response = await post('/api/auth/register/options', { setupToken: TEST_SETUP_TOKEN });

      expect(response.statusCode).toBe(401);
    });

    it('rejects a second concurrent setup that lost the race', async () => {
      await post('/api/auth/register/options', { setupToken: TEST_SETUP_TOKEN });
      verifyRegistration.mockImplementation(async (options) => {
        const expected = options.expectedChallenge as (challenge: string) => Promise<boolean>;
        await expected(lastChallenge);
        // Another setup completes while this one is being verified.
        new AuthStore(db, 90).addCredential({
          id: 'winner',
          publicKey: new Uint8Array([1]),
          counter: 0,
          transports: undefined,
          deviceType: 'singleDevice',
          backedUp: false,
          label: 'Winner',
        });
        return {
          verified: true,
          registrationInfo: {
            credential: { id: 'loser', publicKey: new Uint8Array([2]), counter: 0 },
            credentialDeviceType: 'singleDevice',
            credentialBackedUp: false,
          },
        } as unknown as Awaited<ReturnType<typeof webauthn.verifyRegistrationResponse>>;
      });

      const response = await post('/api/auth/register/verify', {
        response: credentialResponse('loser'),
        setupToken: TEST_SETUP_TOKEN,
        client: 'web',
      });

      expect(response.statusCode).toBe(409);
      expect(new AuthStore(db, 90).listCredentials().map((c) => c.id)).toEqual(['winner']);
    });

    it('rejects a registration the library cannot verify', async () => {
      await post('/api/auth/register/options', { setupToken: TEST_SETUP_TOKEN });
      verifyRegistration.mockRejectedValue(new Error('bad attestation'));

      const response = await post('/api/auth/register/verify', {
        response: credentialResponse(),
        setupToken: TEST_SETUP_TOKEN,
        client: 'web',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'Passkey registration could not be verified' });
    });

    it('rejects a registration the library reports as unverified', async () => {
      await post('/api/auth/register/options', { setupToken: TEST_SETUP_TOKEN });
      verifyRegistration.mockResolvedValue({ verified: false });

      const response = await post('/api/auth/register/verify', {
        response: credentialResponse(),
        setupToken: TEST_SETUP_TOKEN,
        client: 'web',
      });

      expect(response.statusCode).toBe(400);
    });

    it('a challenge can only be used once', async () => {
      await setUp();
      const replayChallenge = lastChallenge;
      mockRegistrationSucceeds(() => replayChallenge, 'cred-2');

      const replay = await post(
        '/api/auth/register/verify',
        { response: credentialResponse('cred-2'), client: 'web' },
        // A signed-in caller replaying the already-used setup challenge.
        { authorization: `Bearer ${new AuthStore(db, 90).createSession('ios', null)}` }
      );

      expect(replay.statusCode).toBe(400);
    });

    it('validates the request body', async () => {
      const response = await post('/api/auth/register/verify', { response: {}, client: 'android' });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('adding passkeys', () => {
    it('lets a signed-in user add another passkey without a new session', async () => {
      const headers = await bearerFor();
      await post('/api/auth/register/options', {}, headers);
      mockRegistrationSucceeds(() => lastChallenge, 'cred-2');

      const response = await post(
        '/api/auth/register/verify',
        { response: credentialResponse('cred-2'), client: 'ios' },
        headers
      );

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        credential: expect.objectContaining({ id: 'cred-2', label: 'Passkey' }) as unknown,
      });
    });

    it('excludes existing passkeys from new registrations', async () => {
      const headers = await bearerFor();

      const response = await post('/api/auth/register/options', {}, headers);

      expect(response.json()).toMatchObject({ excludeCredentials: [{ id: 'cred-1' }] });
    });
  });

  describe('sign-in', () => {
    it('has nothing to sign in to before setup', async () => {
      expect((await post('/api/auth/login/options')).statusCode).toBe(409);
    });

    it('signs in with a known passkey and records its counter', async () => {
      await setUp();
      await post('/api/auth/login/options');
      mockAuthenticationSucceeds(() => lastChallenge, 5);

      const response = await post('/api/auth/login/verify', {
        response: credentialResponse(),
        client: 'web',
      });

      expect(response.statusCode).toBe(200);
      expect(sessionCookie(response)?.value).toMatch(/^[\w-]{43}$/);
      expect(new AuthStore(db, 90).findCredential('cred-1')?.counter).toBe(5);
    });

    it('issues user-verified, discoverable sign-in options', async () => {
      await setUp();

      const response = await post('/api/auth/login/options');

      expect(response.json()).toMatchObject({ rpId: 'localhost', userVerification: 'required' });
      expect(response.json<{ allowCredentials?: unknown[] }>().allowCredentials ?? []).toEqual([]);
    });

    it('rejects an unknown passkey', async () => {
      await setUp();
      await post('/api/auth/login/options');

      const response = await post('/api/auth/login/verify', {
        response: credentialResponse('stranger'),
        client: 'web',
      });

      expect(response.statusCode).toBe(401);
      expect(verifyAuthentication).not.toHaveBeenCalled();
    });

    it.each([
      ['throws', () => verifyAuthentication.mockRejectedValue(new Error('bad signature'))],
      [
        'reports unverified',
        () =>
          verifyAuthentication.mockResolvedValue({ verified: false } as unknown as Awaited<
            ReturnType<typeof webauthn.verifyAuthenticationResponse>
          >),
      ],
    ])('rejects a sign-in the library %s', async (_label, arrange) => {
      await setUp();
      await post('/api/auth/login/options');
      arrange();

      const response = await post('/api/auth/login/verify', {
        response: credentialResponse(),
        client: 'web',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('protected routes', () => {
    it('require a session', async () => {
      const response = await post('/api/sync/pull', {});

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'Sign in required' });
    });

    it('reject an unknown cookie and clear it', async () => {
      const response = await post('/api/sync/pull', {}, { cookie: `${SESSION_COOKIE}=forged` });

      expect(response.statusCode).toBe(401);
      expect(sessionCookie(response)).toMatchObject({ value: '', maxAge: 0 });
    });

    it('accept the session cookie, and reject cookie writes from a foreign origin', async () => {
      const cookie = `${SESSION_COOKIE}=${String(sessionCookie(await setUp('web'))?.value)}`;

      const sameOrigin = await post('/api/sync/pull', {}, { cookie, origin: TEST_ORIGIN });
      const noOrigin = await post('/api/sync/pull', {}, { cookie });
      const foreign = await post('/api/sync/pull', {}, { cookie, origin: 'https://evil.example' });

      expect([sameOrigin.statusCode, noOrigin.statusCode, foreign.statusCode]).toEqual([
        200, 200, 403,
      ]);
    });

    it('do not apply the origin check to bearer tokens', async () => {
      const headers = await bearerFor();

      const response = await post(
        '/api/sync/push',
        { operations: [settingsOp()] },
        {
          ...headers,
          origin: 'capacitor://localhost',
        }
      );

      expect(response.statusCode).toBe(200);
    });

    it('refresh the cookie when the sliding expiry is extended', async () => {
      const cookie = `${SESSION_COOKIE}=${String(sessionCookie(await setUp('web'))?.value)}`;
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);

      const response = await post('/api/sync/pull', {}, { cookie });

      vi.useRealTimers();
      expect(response.statusCode).toBe(200);
      expect(sessionCookie(response)?.maxAge).toBe(90 * 24 * 60 * 60);
    });
  });

  describe('sign-out and session management', () => {
    it('logout ends the session and clears the cookie', async () => {
      const cookie = `${SESSION_COOKIE}=${String(sessionCookie(await setUp('web'))?.value)}`;

      const logout = await post('/api/auth/logout', {}, { cookie });
      const after = await post('/api/sync/pull', {}, { cookie });

      expect(logout.statusCode).toBe(204);
      expect(sessionCookie(logout)).toMatchObject({ value: '', maxAge: 0 });
      expect(after.statusCode).toBe(401);
    });

    it('lists sessions with the current one flagged and revokes others', async () => {
      const headers = await bearerFor();
      const store = new AuthStore(db, 90);
      const other = store.createSession('web', 'cred-1');
      const otherId = store.resolveSession(other)?.id ?? '';

      const list = await app.inject({ method: 'GET', url: '/api/auth/sessions', headers });
      const sessions = list.json<{ id: string; current: boolean }[]>();
      expect(sessions.filter((s) => s.current)).toHaveLength(1);
      expect(sessions.find((s) => s.id === otherId)?.current).toBe(false);

      const revoke = await app.inject({
        method: 'DELETE',
        url: `/api/auth/sessions/${otherId}`,
        headers,
      });
      expect(revoke.statusCode).toBe(204);
      expect(store.resolveSession(other)).toBeNull();

      const missing = await app.inject({
        method: 'DELETE',
        url: '/api/auth/sessions/nope',
        headers,
      });
      expect(missing.statusCode).toBe(404);
    });

    it('revoking the current session signs out', async () => {
      const headers = await bearerFor();
      const sessions = (
        await app.inject({ method: 'GET', url: '/api/auth/sessions', headers })
      ).json<{ id: string; current: boolean }[]>();
      const current = sessions.find((session) => session.current);

      await app.inject({
        method: 'DELETE',
        url: `/api/auth/sessions/${String(current?.id)}`,
        headers,
      });

      expect((await post('/api/sync/pull', {}, headers)).statusCode).toBe(401);
    });

    it('lists passkeys and refuses to remove the only one', async () => {
      const headers = await bearerFor();

      const list = await app.inject({ method: 'GET', url: '/api/auth/credentials', headers });
      const remove = await app.inject({
        method: 'DELETE',
        url: '/api/auth/credentials/cred-1',
        headers,
      });

      expect(list.json()).toEqual([expect.objectContaining({ id: 'cred-1', label: 'MacBook' })]);
      expect(remove.statusCode).toBe(409);
    });

    it('removes another passkey, and 404s an unknown one', async () => {
      const headers = await bearerFor();
      new AuthStore(db, 90).addCredential({
        id: 'cred-2',
        publicKey: new Uint8Array([1]),
        counter: 0,
        transports: undefined,
        deviceType: 'singleDevice',
        backedUp: false,
        label: 'Old phone',
      });

      const remove = await app.inject({
        method: 'DELETE',
        url: '/api/auth/credentials/cred-2',
        headers,
      });
      const missing = await app.inject({
        method: 'DELETE',
        url: '/api/auth/credentials/nope',
        headers,
      });

      expect([remove.statusCode, missing.statusCode]).toEqual([204, 404]);
    });
  });

  describe('development bypass', () => {
    it('treats every request as signed in', async () => {
      const bypass = testApp(memoryDb(), { auth: testAuthConfig({ devBypass: true }) }).app;

      const status = await bypass.inject({ method: 'GET', url: '/api/auth/status' });
      const pull = await bypass.inject({ method: 'POST', url: '/api/sync/pull', payload: {} });
      const logout = await bypass.inject({ method: 'POST', url: '/api/auth/logout' });

      expect(status.json()).toMatchObject({ authenticated: true });
      expect([pull.statusCode, logout.statusCode]).toEqual([200, 204]);
    });
  });

  it('rate-limits the unauthenticated auth routes more tightly', async () => {
    const limited = testApp(memoryDb(), { auth: testAuthConfig({ rateLimitPerMinute: 2 }) }).app;

    const statuses: number[] = [];
    for (let index = 0; index < 3; index++) {
      statuses.push(
        (await limited.inject({ method: 'POST', url: '/api/auth/login/options' })).statusCode
      );
    }

    expect(statuses).toEqual([409, 409, 429]);
  });

  it('returns a generic 500 for unexpected errors without leaking details', async () => {
    vi.spyOn(AuthStore.prototype, 'hasCredentials').mockImplementationOnce(() => {
      throw new Error('disk on fire');
    });

    const response = await post('/api/auth/login/options');

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'Internal server error' });
  });
});
