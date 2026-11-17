import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { vi } from 'vitest';
import { SyncService, type SyncStatus } from '../services/sync.service';
import { PreferenceStorageService } from '../storage/preference-storage.service';
import { AuthFlowError, AuthService, describeHttpError, SIGNED_IN_KEY } from './auth.service';

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
  let navigateByUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new Map();
    syncStatus = signal<SyncStatus>('idle');
    resumeAfterReauth = vi.fn(() => Promise.resolve());
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
        { provide: SyncService, useValue: { status: syncStatus.asReadonly(), resumeAfterReauth } },
        { provide: Router, useValue: { navigateByUrl } },
      ],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('starts signed out and restores the local marker', async () => {
    expect(service.signedIn()).toBe(false);

    store.set(SIGNED_IN_KEY, 'true');
    await service.initialize();

    expect(service.signedIn()).toBe(true);
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

  it('signs out (even offline) and returns to the sign-in screen', async () => {
    store.set(SIGNED_IN_KEY, 'true');
    await service.initialize();

    const done = service.signOut();
    http.expectOne('/api/auth/logout').error(new ProgressEvent('offline'));
    await done;

    expect(service.signedIn()).toBe(false);
    expect(store.has(SIGNED_IN_KEY)).toBe(false);
    expect(navigateByUrl).toHaveBeenCalledWith('/login');
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
