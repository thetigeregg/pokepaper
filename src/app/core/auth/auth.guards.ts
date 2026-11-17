import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** App routes: require the local signed-in marker (works offline; never calls the server). */
export const signedInGuard: CanActivateFn = () =>
  inject(AuthService).signedIn() ? true : inject(Router).parseUrl('/login');

/** The sign-in screen: skip it when already signed in. */
export const signedOutGuard: CanActivateFn = () =>
  inject(AuthService).signedIn() ? inject(Router).parseUrl('/tabs') : true;
