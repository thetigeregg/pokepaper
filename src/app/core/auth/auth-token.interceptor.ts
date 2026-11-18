import type { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { AuthTokenStore } from './auth-token.store';

/**
 * Sends the iOS app's session token as `Authorization: Bearer …` on requests
 * to the PokePaper server. Only native builds have an `apiUrl` and a token;
 * the web app is same-origin and relies on its httpOnly cookie, so this
 * leaves web requests alone. Requests to any other host never get the token.
 */
export const authTokenInterceptor: HttpInterceptorFn = (request, next) => {
  const token = inject(AuthTokenStore).token();
  if (!token || !environment.apiUrl || !request.url.startsWith(`${environment.apiUrl}/`)) {
    return next(request);
  }
  return next(request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};
