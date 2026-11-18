import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { vi, type Mock } from 'vitest';
import { SyncService, type SyncStatus } from '../services/sync.service';
import { PreferenceStorageService } from '../storage/preference-storage.service';
import { AuthTokenStore } from './auth-token.store';
import {
  AuthFlowError,
  AuthService,
  describeHttpError,
  PENDING_SIGN_OUT_KEY,
  SIGNED_IN_KEY,
} from './auth.service';
import { PasskeyClient } from './passkey-client';

const isNativePlatformMock = vi.fn<() => boolean>(() => false);

vi.mock('../utils/native-platform.util', () => ({
  isNativePlatform: () => isNativePlatformMock(),
}));

vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: vi.fn(),
  startAuthentication: vi.fn(),
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function domError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;
  let store: Map<string, string>;
  let syncStatus: ReturnType<typeof signal<SyncStatus>>;
  let resumeAfterReauth: ReturnType<typeof vi.fn>;
  let pause: ReturnType<typeof vi.fn>;
  let navigateByUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    isNativePlatformMock.mockReturnValue(false);
    store = new Map();
    syncStatus = signal<SyncStatus>('idle');
    resumeAfterReauth = vi.fn(() => Promise.resolve());
    pause = vi.fn();
    navigateByUrl = vi.fn(() => Promise.resolve(true));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: PreferenceStorageService,
          useValue: {
            getItem: (key: string) => Promise.resolve(store.get(key) ?? null),
            setItem: (key: string, value: string) => Promise.resolve(void store.set(key, value)),
            removeItem: (key: string) => Promise.resolve(void store.delete(key)),
          },
        },
        {
          provide: SyncService,
          useValue: { status: syncStatus.asReadonly(), resumeAfterReauth, pause },
        },
        { provide: Router, useValue: { navigateByUrl } },
      ],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('starts signed out with sync paused', async () => {
    await service.initialize();

    expect(service.signedIn()).toBe(false);
    expect(pause).toHaveBeenCalled();
  });

  it('restores the local marker without pausing sync', async () => {
    store.set(SIGNED_IN_KEY, 'true');
    await service.initialize();

    expect(service.signedIn()).toBe(true);
    expect(pause).not.toHaveBeenCalled();
  });

  it('fetches auth status', async () => {
    const status = service.status();
    http
      .expectOne('/api/auth/status')
      .flush({ registered: true, authenticated: false, setupAvailable: false });

    await expect(status).resolves.toEqual({
      registered: true,
      authenticated: false,
      setupAvailable: false,
    });
  });

  it('sets up the first passkey with the setup token and signs in', async () => {
    vi.mocked(startRegistration).mockResolvedValue({ id: 'cred' } as never);

    const done = service.setUp('the-setup-token', 'MacBook');
    const options = http.expectOne('/api/auth/register/options');
    expect(options.request.body).toEqual({ setupToken: 'the-setup-token' });
    options.flush({ challenge: 'c1' });
    await flush();

    const verify = http.expectOne('/api/auth/register/verify');
    expect(verify.request.body).toEqual({
      response: { id: 'cred' },
      setupToken: 'the-setup-token',
      label: 'MacBook',
      client: 'web',
    });
    verify.flush({ credential: { id: 'cred' } });
    await done;

    expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: { challenge: 'c1' } });
    expect(service.signedIn()).toBe(true);
    expect(store.get(SIGNED_IN_KEY)).toBe('true');
    expect(resumeAfterReauth).toHaveBeenCalled();
  });

  it('signs in with a passkey', async () => {
    vi.mocked(startAuthentication).mockResolvedValue({ id: 'cred' } as never);

    const done = service.signIn();
    http.expectOne('/api/auth/login/options').flush({ challenge: 'c2' });
    await flush();
    const verify = http.expectOne('/api/auth/login/verify');
    expect(verify.request.body).toEqual({ response: { id: 'cred' }, client: 'web' });
    verify.flush({});
    await done;

    expect(service.signedIn()).toBe(true);
  });

  it('surfaces server error messages', async () => {
    const done = service.signIn();
    http
      .expectOne('/api/auth/login/options')
      .flush({ error: 'No passkey is registered yet' }, { status: 409, statusText: 'Conflict' });

    await expect(done).rejects.toEqual(new AuthFlowError('No passkey is registered yet'));
    expect(service.signedIn()).toBe(false);
  });

  it.each([
    ['NotAllowedError', /cancelled or timed out/],
    ['AbortError', /cancelled or timed out/],
    ['InvalidStateError', /already has a PokePaper passkey/],
    ['NotSupportedError', /not available in this browser/],
  ])('explains a %s from the passkey prompt', async (name, message) => {
    vi.mocked(startAuthentication).mockRejectedValue(domError(name));

    const done = service.signIn();
    http.expectOne('/api/auth/login/options').flush({ challenge: 'c' });

    await expect(done).rejects.toThrow(message);
  });

  it('adds a passkey without changing sign-in state', async () => {
    vi.mocked(startRegistration).mockResolvedValue({ id: 'cred-2' } as never);

    const done = service.addPasskey('iPhone');
    const options = http.expectOne('/api/auth/register/options');
    expect(options.request.body).toEqual({});
    options.flush({ challenge: 'c3' });
    await flush();
    const verify = http.expectOne('/api/auth/register/verify');
    expect(verify.request.body).toEqual({
      response: { id: 'cred-2' },
      label: 'iPhone',
      client: 'web',
    });
    verify.flush({ credential: { id: 'cred-2', label: 'iPhone' } });

    await expect(done).resolves.toEqual({ id: 'cred-2', label: 'iPhone' });
    expect(service.signedIn()).toBe(false);
  });

  it('lists and removes passkeys and sessions', async () => {
    const passkeys = service.listPasskeys();
    http.expectOne('/api/auth/credentials').flush([{ id: 'a' }]);
    await expect(passkeys).resolves.toEqual([{ id: 'a' }]);

    const removal = service.removePasskey('a/b');
    http
      .expectOne((req) => req.method === 'DELETE' && req.url === '/api/auth/credentials/a%2Fb')
      .flush(null);
    await removal;

    const sessions = service.listSessions();
    http.expectOne('/api/auth/sessions').flush([{ id: 's' }]);
    await expect(sessions).resolves.toEqual([{ id: 's' }]);

    const revoke = service.revokeSession('s');
    http
      .expectOne((req) => req.method === 'DELETE' && req.url === '/api/auth/sessions/s')
      .flush(null);
    await revoke;
  });

  it('signs out, pauses sync, and returns to the sign-in screen', async () => {
    store.set(SIGNED_IN_KEY, 'true');
    await service.initialize();

    const done = service.signOut();
    http.expectOne('/api/auth/logout').flush(null);
    await done;

    expect(service.signedIn()).toBe(false);
    expect(store.has(SIGNED_IN_KEY)).toBe(false);
    expect(store.has(PENDING_SIGN_OUT_KEY)).toBe(false);
    expect(pause).toHaveBeenCalled();
    expect(navigateByUrl).toHaveBeenCalledWith('/login');
  });

  it('remembers a sign-out that could not reach the server', async () => {
    store.set(SIGNED_IN_KEY, 'true');
    await service.initialize();

    const done = service.signOut();
    http.expectOne('/api/auth/logout').error(new ProgressEvent('offline'));
    await done;

    expect(service.signedIn()).toBe(false);
    expect(store.get(PENDING_SIGN_OUT_KEY)).toBe('true');
  });

  it('does not remember a sign-out whose session had already expired', async () => {
    const done = service.signOut();
    http.expectOne('/api/auth/logout').flush(null, { status: 401, statusText: 'Unauthorized' });
    await done;

    expect(store.has(PENDING_SIGN_OUT_KEY)).toBe(false);
  });

  it('completes a pending sign-out on the server', async () => {
    await expect(service.completePendingSignOut()).resolves.toBe(true);
    http.expectNone('/api/auth/logout');

    store.set(PENDING_SIGN_OUT_KEY, 'true');
    const offline = service.completePendingSignOut();
    await flush();
    http.expectOne('/api/auth/logout').error(new ProgressEvent('offline'));
    await expect(offline).resolves.toBe(false);
    expect(store.get(PENDING_SIGN_OUT_KEY)).toBe('true');

    const online = service.completePendingSignOut();
    await flush();
    http.expectOne('/api/auth/logout').flush(null);
    await expect(online).resolves.toBe(true);
    expect(store.has(PENDING_SIGN_OUT_KEY)).toBe(false);
  });

  it('treats a 401 as a completed pending sign-out', async () => {
    store.set(PENDING_SIGN_OUT_KEY, 'true');

    const done = service.completePendingSignOut();
    await flush();
    http.expectOne('/api/auth/logout').flush(null, { status: 401, statusText: 'Unauthorized' });

    await expect(done).resolves.toBe(true);
    expect(store.has(PENDING_SIGN_OUT_KEY)).toBe(false);
  });

  it('a new sign-in clears any pending sign-out', async () => {
    store.set(PENDING_SIGN_OUT_KEY, 'true');

    await service.adoptExistingSession();

    expect(store.has(PENDING_SIGN_OUT_KEY)).toBe(false);
  });

  it('ends the local session when a signed-in call gets a 401', async () => {
    store.set(SIGNED_IN_KEY, 'true');
    await service.initialize();

    const done = service.listPasskeys();
    http
      .expectOne('/api/auth/credentials')
      .flush({ error: 'Sign in required' }, { status: 401, statusText: 'Unauthorized' });

    await expect(done).rejects.toThrow(/session has ended/);
    expect(service.signedIn()).toBe(false);
    expect(navigateByUrl).toHaveBeenCalledWith('/login');
  });

  it('does not treat a failed sign-in (401) as a session ending', async () => {
    vi.mocked(startAuthentication).mockResolvedValue({ id: 'stranger' } as never);

    const done = service.signIn();
    http.expectOne('/api/auth/login/options').flush({ challenge: 'c' });
    await flush();
    http
      .expectOne('/api/auth/login/verify')
      .flush({ error: 'Unknown passkey' }, { status: 401, statusText: 'Unauthorized' });

    await expect(done).rejects.toEqual(new AuthFlowError('Unknown passkey'));
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('ends the local session when sync reports the server rejected it', async () => {
    store.set(SIGNED_IN_KEY, 'true');
    await service.initialize();
    TestBed.tick();

    syncStatus.set('unauthorized');
    TestBed.tick();
    await flush();

    expect(service.signedIn()).toBe(false);
    expect(navigateByUrl).toHaveBeenCalledWith('/login');
  });

  it('adopts a session the server already recognizes', async () => {
    await service.adoptExistingSession();

    expect(service.signedIn()).toBe(true);
  });

  it('describes HTTP failures for people', () => {
    expect(describeHttpError(new HttpErrorResponse({ status: 0 }))).toMatch(
      /Can't reach the server/
    );
    expect(describeHttpError(new HttpErrorResponse({ status: 500, error: null }))).toBe(
      'The server returned an error (500).'
    );
    expect(describeHttpError(new Error('x'))).toMatch(/Something went wrong/);
  });
});

describe('AuthService in the iOS app', () => {
  let service: AuthService;
  let http: HttpTestingController;
  let store: Map<string, string>;
  let syncStatus: ReturnType<typeof signal<SyncStatus>>;
  let keychain: { token: string | null };
  let tokens: { load: Mock; token: () => string | null; set: Mock; clear: Mock };
  let passkeys: { register: Mock; authenticate: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    isNativePlatformMock.mockReturnValue(true);
    store = new Map();
    syncStatus = signal<SyncStatus>('idle');
    keychain = { token: null };
    tokens = {
      load: vi.fn(() => Promise.resolve()),
      token: () => keychain.token,
      set: vi.fn((token: string) => Promise.resolve(void (keychain.token = token))),
      clear: vi.fn(() => Promise.resolve(void (keychain.token = null))),
    };
    passkeys = {
      register: vi.fn(() => Promise.resolve({ id: 'ios-reg' })),
      authenticate: vi.fn(() => Promise.resolve({ id: 'ios-auth' })),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: PreferenceStorageService,
          useValue: {
            getItem: (key: string) => Promise.resolve(store.get(key) ?? null),
            setItem: (key: string, value: string) => Promise.resolve(void store.set(key, value)),
            removeItem: (key: string) => Promise.resolve(void store.delete(key)),
          },
        },
        {
          provide: SyncService,
          useValue: {
            status: syncStatus.asReadonly(),
            resumeAfterReauth: vi.fn(() => Promise.resolve()),
            pause: vi.fn(),
          },
        },
        { provide: Router, useValue: { navigateByUrl: vi.fn(() => Promise.resolve(true)) } },
        { provide: AuthTokenStore, useValue: tokens },
        { provide: PasskeyClient, useValue: passkeys },
      ],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  async function signedIn(token = 'tok-old'): Promise<void> {
    keychain.token = token;
    store.set(SIGNED_IN_KEY, 'true');
    await service.initialize();
  }

  it('loads the Keychain token on startup', async () => {
    await service.initialize();

    expect(tokens.load).toHaveBeenCalled();
  });

  it('signs in natively as an iOS client and keeps the token', async () => {
    const done = service.signIn();
    http.expectOne('/api/auth/login/options').flush({ challenge: 'c2' });
    await flush();
    const verify = http.expectOne('/api/auth/login/verify');
    expect(verify.request.body).toEqual({ response: { id: 'ios-auth' }, client: 'ios' });
    verify.flush({ token: 'tok-new' });
    await done;

    expect(passkeys.authenticate).toHaveBeenCalledWith({ challenge: 'c2' });
    expect(tokens.set).toHaveBeenCalledWith('tok-new');
    expect(service.signedIn()).toBe(true);
  });

  it('sets up the first passkey natively and keeps the token', async () => {
    const done = service.setUp('the-setup-token', 'iPhone');
    http.expectOne('/api/auth/register/options').flush({ challenge: 'c1' });
    await flush();
    const verify = http.expectOne('/api/auth/register/verify');
    expect(verify.request.body).toMatchObject({ response: { id: 'ios-reg' }, client: 'ios' });
    verify.flush({ credential: { id: 'cred' }, token: 'tok-setup' });
    await done;

    expect(keychain.token).toBe('tok-setup');
    expect(service.signedIn()).toBe(true);
  });

  it('refuses a sign-in response without a token', async () => {
    const done = service.signIn();
    http.expectOne('/api/auth/login/options').flush({ challenge: 'c2' });
    await flush();
    http.expectOne('/api/auth/login/verify').flush({});

    await expect(done).rejects.toThrow(/did not return a session/);
    expect(service.signedIn()).toBe(false);
  });

  it('adopts a session the server recognizes without a token (AUTH_DEV_BYPASS)', async () => {
    await service.adoptExistingSession();

    expect(service.signedIn()).toBe(true);
    expect(tokens.set).not.toHaveBeenCalled();
  });

  it('adopts a session backed by a surviving Keychain token', async () => {
    keychain.token = 'tok-survivor';

    await service.adoptExistingSession();

    expect(service.signedIn()).toBe(true);
    expect(tokens.set).not.toHaveBeenCalled();
  });

  it('drops the token after signing out on the server', async () => {
    await signedIn();

    const done = service.signOut();
    http.expectOne('/api/auth/logout').flush(null);
    await done;

    expect(keychain.token).toBeNull();
    expect(service.signedIn()).toBe(false);
  });

  it('keeps the token for a pending sign-out, then drops it once that completes', async () => {
    await signedIn();

    const offline = service.signOut();
    http.expectOne('/api/auth/logout').error(new ProgressEvent('offline'));
    await offline;
    expect(keychain.token).toBe('tok-old');
    expect(store.get(PENDING_SIGN_OUT_KEY)).toBe('true');

    const online = service.completePendingSignOut();
    await flush();
    http.expectOne('/api/auth/logout').flush(null);
    await expect(online).resolves.toBe(true);
    expect(keychain.token).toBeNull();
  });

  it('drops the token when a signed-in call gets a 401', async () => {
    await signedIn();

    const done = service.listSessions();
    http
      .expectOne('/api/auth/sessions')
      .flush({ error: 'Sign in required' }, { status: 401, statusText: 'Unauthorized' });

    await expect(done).rejects.toThrow(/session has ended/);
    expect(keychain.token).toBeNull();
  });

  it('drops the token when sync reports the server rejected the session', async () => {
    await signedIn();
    TestBed.tick();

    syncStatus.set('unauthorized');
    TestBed.tick();
    await flush();

    expect(keychain.token).toBeNull();
    expect(service.signedIn()).toBe(false);
  });

  it('describes a device without passkeys', async () => {
    passkeys.authenticate.mockRejectedValue(new Error('no passkeys here'));

    const done = service.signIn();
    http.expectOne('/api/auth/login/options').flush({ challenge: 'c2' });

    await expect(done).rejects.toThrow('Passkeys are not available on this device.');
  });
});
