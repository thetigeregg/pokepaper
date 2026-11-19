import {
  HttpClient,
  HttpContext,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { authTokenInterceptor, WITHOUT_SESSION_TOKEN } from './auth-token.interceptor';
import { AuthTokenStore, KeychainUnavailableError } from './auth-token.store';

describe('authTokenInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let token: string | null;
  let keychainLocked: boolean;
  const originalApiUrl = environment.apiUrl;

  beforeEach(() => {
    token = 'tok-1';
    keychainLocked = false;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authTokenInterceptor])),
        provideHttpClientTesting(),
        {
          provide: AuthTokenStore,
          useValue: {
            requestToken: () =>
              keychainLocked
                ? Promise.reject(new KeychainUnavailableError('locked'))
                : Promise.resolve(token),
          },
        },
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    controller.verify();
    environment.apiUrl = originalApiUrl;
  });

  /** The Authorization header the request went out with. */
  async function authorizationFor(
    url: string,
    headers: Record<string, string> = {}
  ): Promise<string | null> {
    const response = firstValueFrom(http.get(url, { headers }));
    await Promise.resolve(); // let the interceptor read the token
    const request = controller.expectOne(url);
    request.flush({});
    await response;
    return request.request.headers.get('Authorization');
  }

  it('sends the bearer token to the PokePaper server', async () => {
    environment.apiUrl = 'https://pokepaper.example.com';

    expect(await authorizationFor('https://pokepaper.example.com/api/sync/pull')).toBe(
      'Bearer tok-1'
    );
    expect(await authorizationFor('https://pokepaper.example.com/images/catalog/a.webp')).toBe(
      'Bearer tok-1'
    );
  });

  it('never sends the token to another host', async () => {
    environment.apiUrl = 'https://pokepaper.example.com';

    expect(
      await authorizationFor('https://pokepaper.example.com.evil.test/api/sync/pull')
    ).toBeNull();
    expect(await authorizationFor('https://assets.tcgdex.net/en/sv/sv01/001')).toBeNull();
  });

  it('leaves requests alone without a token', async () => {
    environment.apiUrl = 'https://pokepaper.example.com';
    token = null;

    expect(await authorizationFor('https://pokepaper.example.com/api/sync/pull')).toBeNull();
  });

  it('keeps an explicit Authorization header (revoking a specific session)', async () => {
    environment.apiUrl = 'https://pokepaper.example.com';

    expect(
      await authorizationFor('https://pokepaper.example.com/api/auth/logout', {
        Authorization: 'Bearer tok-retired',
      })
    ).toBe('Bearer tok-retired');
  });

  it('fails like a network error, without sending, while the Keychain is unreadable', async () => {
    environment.apiUrl = 'https://pokepaper.example.com';
    keychainLocked = true;

    const failure = firstValueFrom(http.get('https://pokepaper.example.com/api/sync/pull'));

    await expect(failure).rejects.toMatchObject({ status: 0, statusText: 'Keychain unavailable' });
    await expect(failure).rejects.toBeInstanceOf(HttpErrorResponse);
    controller.expectNone('https://pokepaper.example.com/api/sync/pull');
  });

  it('never sends the token, or waits on the Keychain, for requests that opt out', async () => {
    environment.apiUrl = 'https://pokepaper.example.com';
    keychainLocked = true;
    const url = 'https://pokepaper.example.com/ota/ios/3/manifest.json';

    const response = firstValueFrom(
      http.get(url, { context: new HttpContext().set(WITHOUT_SESSION_TOKEN, true) })
    );
    const request = controller.expectOne(url);
    request.flush({});
    await response;

    expect(request.request.headers.get('Authorization')).toBeNull();
  });

  it('leaves same-origin web requests alone (cookie sessions)', async () => {
    environment.apiUrl = '';

    expect(await authorizationFor('/api/sync/pull')).toBeNull();
  });
});
