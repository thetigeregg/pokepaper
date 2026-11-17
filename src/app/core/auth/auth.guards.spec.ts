import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type UrlTree } from '@angular/router';
import { signedInGuard, signedOutGuard } from './auth.guards';
import { AuthService } from './auth.service';

describe('auth guards', () => {
  const signedIn = signal(false);

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: { signedIn } }],
    });
  });

  function run(guard: typeof signedInGuard): true | string {
    const result = TestBed.runInInjectionContext(() => guard({} as never, {} as never)) as
      true | UrlTree;
    return result === true ? true : TestBed.inject(Router).serializeUrl(result);
  }

  it('sends signed-out users to /login and lets signed-in users through', () => {
    signedIn.set(false);
    expect(run(signedInGuard)).toBe('/login');
    signedIn.set(true);
    expect(run(signedInGuard)).toBe(true);
  });

  it('skips the sign-in screen when already signed in', () => {
    signedIn.set(true);
    expect(run(signedOutGuard)).toBe('/tabs');
    signedIn.set(false);
    expect(run(signedOutGuard)).toBe(true);
  });
});
