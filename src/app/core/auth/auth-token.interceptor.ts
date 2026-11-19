import { HttpContextToken, HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthTokenStore } from './auth-token.store';

/**
 * Sends the iOS app's session token as `Authorization: Bearer …` on requests
 * to the PokePaper server. Only native builds have an `apiUrl` and a token;
 * the web app is same-origin and relies on its httpOnly cookie, so this
 * leaves web requests alone. Requests to any other host never get the token,
 * and a request that already sets `Authorization` (revoking a specific
 * session) keeps it.
 *
 * If the Keychain can't be read, the request fails like a network error
 * (status 0): sync then waits and retries, where a request without the token
 * would get a 401 and sign the user out.
 */
/**
 * Set on requests for public static files (the OTA manifest), so they never
 * carry the session token or wait on the Keychain.
 */
export const WITHOUT_SESSION_TOKEN = new HttpContextToken<boolean>(() => false);

export const authTokenInterceptor: HttpInterceptorFn = (request, next) => {
  if (
    request.context.get(WITHOUT_SESSION_TOKEN) ||
    !environment.apiUrl ||
    !request.url.startsWith(`${environment.apiUrl}/`) ||
    request.headers.has('Authorization')
  ) {
    return next(request);
  }
  const tokens = inject(AuthTokenStore);
  return from(tokens.requestToken()).pipe(
    catchError((error: unknown) =>
      throwError(
        () =>
          new HttpErrorResponse({
            error,
            status: 0,
            statusText: 'Keychain unavailable',
            url: request.url,
          })
      )
    ),
    switchMap((token) =>
      next(token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request)
    )
  );
};
