import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { authTokenInterceptor } from './auth-token.interceptor';
import { AuthTokenStore } from './auth-token.store';

describe('authTokenInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let token: string | null;
  const originalApiUrl = environment.apiUrl;

  beforeEach(() => {
    token = 'tok-1';
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authTokenInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthTokenStore, useValue: { token: () => token } },
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    controller.verify();
    environment.apiUrl = originalApiUrl;
  });

  function authorizationFor(url: string): string | null {
    void firstValueFrom(http.get(url));
    const request = controller.expectOne(url);
    request.flush({});
    return request.request.headers.get('Authorization');
  }

  it('sends the bearer token to the PokePaper server', () => {
    environment.apiUrl = 'https://pokepaper.example.com';

    expect(authorizationFor('https://pokepaper.example.com/api/sync/pull')).toBe('Bearer tok-1');
    expect(authorizationFor('https://pokepaper.example.com/images/catalog/a.webp')).toBe(
      'Bearer tok-1'
    );
  });

  it('never sends the token to another host', () => {
    environment.apiUrl = 'https://pokepaper.example.com';

    expect(authorizationFor('https://pokepaper.example.com.evil.test/api/sync/pull')).toBeNull();
    expect(authorizationFor('https://assets.tcgdex.net/en/sv/sv01/001')).toBeNull();
  });

  it('leaves requests alone without a token', () => {
    environment.apiUrl = 'https://pokepaper.example.com';
    token = null;

    expect(authorizationFor('https://pokepaper.example.com/api/sync/pull')).toBeNull();
  });

  it('leaves same-origin web requests alone (cookie sessions)', () => {
    environment.apiUrl = '';

    expect(authorizationFor('/api/sync/pull')).toBeNull();
  });
});
