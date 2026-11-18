import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type {
  AuthStatusResponse,
  ClientKind,
  CredentialSummary,
  RegisterVerifyResponse,
  SessionCreatedResponse,
  SessionSummary,
} from '@pokepaper/shared';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { firstValueFrom, type Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SyncService } from '../services/sync.service';
import { PreferenceStorageService } from '../storage/preference-storage.service';
import { isNativePlatform } from '../utils/native-platform.util';
import { AuthTokenStore } from './auth-token.store';
import { PasskeyClient } from './passkey-client';

/** Local marker: this device has signed in and hasn't since been told the session ended. */
export const SIGNED_IN_KEY = 'pokepaper.auth.signedIn';
/** Set when a sign-out couldn't reach the server; the server session is ended before the next sign-in check. */
export const PENDING_SIGN_OUT_KEY = 'pokepaper.auth.pendingSignOut';

/**
 * The web app authenticates with an httpOnly session cookie. The iOS app
 * asks for its session as a bearer token instead, kept in the Keychain
 * (`AuthTokenStore`) and sent by `authTokenInterceptor`.
 */
function clientKind(): ClientKind {
  return isNativePlatform() ? 'ios' : 'web';
}

/** A user-facing auth failure. */
export class AuthFlowError extends Error {
  override readonly name = 'AuthFlowError';
}

/**
 * Passkey sign-in state for the app (docs/auth.md).
 *
 * Offline-first: whether the app opens to the tabs or the sign-in screen
 * depends only on a locally stored marker, never on reaching the server. The
 * marker is cleared on sign-out, or when the server rejects the session (sync
 * reports `unauthorized`), which sends the user to the sign-in screen. Queued
 * offline changes survive that and sync after signing back in.
 *
 * Sync only runs while signed in. A sign-out made offline is remembered and
 * completed on the server before the sign-in screen next checks the session,
 * so a surviving cookie (or, in the iOS app, Keychain token) can't silently
 * sign the user back in. The iOS token is kept until that server sign-out
 * succeeds, because completing it needs the token.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly preferences = inject(PreferenceStorageService);
  private readonly syncService = inject(SyncService);
  private readonly tokens = inject(AuthTokenStore);
  private readonly passkeys = inject(PasskeyClient);

  private readonly _signedIn = signal(false);
  readonly signedIn = this._signedIn.asReadonly();

  constructor() {
    effect(() => {
      if (this.syncService.status() === 'unauthorized' && this._signedIn()) {
        void this.discardSession();
      }
    });
  }

  /**
   * Loads the local marker (and, in the iOS app, the session token). Runs in
   * an app initializer, before the first navigation and the first API request.
   */
  async initialize(): Promise<void> {
    await this.tokens.load();
    const signedIn = (await this.preferences.getItem(SIGNED_IN_KEY)) === 'true';
    this._signedIn.set(signedIn);
    if (!signedIn) {
      this.syncService.pause();
    }
  }

  /**
   * Completes a sign-out that couldn't reach the server earlier. Resolves
   * true when no sign-out is pending anymore (so an existing server session
   * may be adopted), false while it still can't be completed.
   */
  async completePendingSignOut(): Promise<boolean> {
    if ((await this.preferences.getItem(PENDING_SIGN_OUT_KEY)) !== 'true') {
      return true;
    }
    try {
      await firstValueFrom(this.http.post(this.url('/logout'), {}));
    } catch (error: unknown) {
      // A 401 means the session is already gone: that also completes it.
      if (!(error instanceof HttpErrorResponse && error.status === 401)) {
        return false;
      }
    }
    await this.tokens.clear();
    await this.preferences.removeItem(PENDING_SIGN_OUT_KEY);
    return true;
  }

  status(): Promise<AuthStatusResponse> {
    return firstValueFrom(this.http.get<AuthStatusResponse>(this.url('/status')));
  }

  /** First-time setup: registers the first passkey with the server's setup token and signs in. */
  async setUp(setupToken: string, label: string): Promise<void> {
    const optionsJSON = await this.request(() =>
      this.http.post<PublicKeyCredentialCreationOptionsJSON>(this.url('/register/options'), {
        setupToken,
      })
    );
    const response = await this.runCeremony(() => this.passkeys.register(optionsJSON));
    const result = await this.request(() =>
      this.http.post<RegisterVerifyResponse>(this.url('/register/verify'), {
        response,
        setupToken,
        label,
        client: clientKind(),
      })
    );
    await this.markSignedIn(result);
  }

  async signIn(): Promise<void> {
    const optionsJSON = await this.request(() =>
      this.http.post<PublicKeyCredentialRequestOptionsJSON>(this.url('/login/options'), {})
    );
    const response = await this.runCeremony(() => this.passkeys.authenticate(optionsJSON));
    const result = await this.request(() =>
      this.http.post<SessionCreatedResponse>(this.url('/login/verify'), {
        response,
        client: clientKind(),
      })
    );
    await this.markSignedIn(result);
  }

  /**
   * Marks this device signed in when the server already recognizes its
   * session (e.g. a surviving cookie, a Keychain token that outlived a
   * reinstall, or a dev server running with AUTH_DEV_BYPASS).
   */
  async adoptExistingSession(): Promise<void> {
    await this.markSignedIn();
  }

  /** Adds another passkey to the signed-in account. */
  async addPasskey(label: string): Promise<CredentialSummary> {
    const optionsJSON = await this.request(
      () =>
        this.http.post<PublicKeyCredentialCreationOptionsJSON>(this.url('/register/options'), {}),
      { requiresSession: true }
    );
    const response = await this.runCeremony(() => this.passkeys.register(optionsJSON));
    const result = await this.request(
      () =>
        this.http.post<RegisterVerifyResponse>(this.url('/register/verify'), {
          response,
          label,
          client: clientKind(),
        }),
      { requiresSession: true }
    );
    return result.credential;
  }

  listPasskeys(): Promise<CredentialSummary[]> {
    return this.request(() => this.http.get<CredentialSummary[]>(this.url('/credentials')), {
      requiresSession: true,
    });
  }

  async removePasskey(id: string): Promise<void> {
    await this.request(() => this.http.delete(this.url(`/credentials/${encodeURIComponent(id)}`)), {
      requiresSession: true,
    });
  }

  listSessions(): Promise<SessionSummary[]> {
    return this.request(() => this.http.get<SessionSummary[]>(this.url('/sessions')), {
      requiresSession: true,
    });
  }

  async revokeSession(id: string): Promise<void> {
    await this.request(() => this.http.delete(this.url(`/sessions/${encodeURIComponent(id)}`)), {
      requiresSession: true,
    });
  }

  /**
   * Ends the server session (best effort: works offline too) and returns to
   * the sign-in screen. Local data and queued changes are kept.
   */
  async signOut(): Promise<void> {
    let serverSessionEnded = true;
    try {
      await firstValueFrom(this.http.post(this.url('/logout'), {}));
    } catch (error: unknown) {
      // Already expired (401) needs nothing more. Otherwise (offline, server
      // down) finish the server sign-out before the next sign-in check.
      if (!(error instanceof HttpErrorResponse && error.status === 401)) {
        serverSessionEnded = false;
        await this.preferences.setItem(PENDING_SIGN_OUT_KEY, 'true');
      }
    }
    if (serverSessionEnded) {
      await this.tokens.clear();
    }
    await this.endLocalSession();
  }

  /**
   * Marks this device signed in. After a passkey ceremony, `session` is the
   * server's response: the iOS app must get its token there (the web gets a
   * cookie instead) and keeps it in the Keychain.
   */
  private async markSignedIn(session?: SessionCreatedResponse): Promise<void> {
    if (session && clientKind() === 'ios') {
      if (!session.token) {
        throw new AuthFlowError('The server did not return a session. Please try again.');
      }
      await this.tokens.set(session.token);
    }
    await this.preferences.removeItem(PENDING_SIGN_OUT_KEY);
    await this.preferences.setItem(SIGNED_IN_KEY, 'true');
    this._signedIn.set(true);
    void this.syncService.resumeAfterReauth();
  }

  /** The server rejected the session: its token is useless, so drop it too. */
  private async discardSession(): Promise<void> {
    await this.tokens.clear();
    await this.endLocalSession();
  }

  private async endLocalSession(): Promise<void> {
    this.syncService.pause();
    this._signedIn.set(false);
    await this.preferences.removeItem(SIGNED_IN_KEY);
    await this.router.navigateByUrl('/login');
  }

  private url(path: string): string {
    return `${environment.apiUrl}/api/auth${path}`;
  }

  /**
   * Runs an API call, converting HTTP failures into user-facing messages. For
   * calls that need a session, a 401 means it has ended (expired, revoked
   * from another device, or its passkey removed): sign out locally.
   */
  private async request<T>(
    call: () => Observable<T>,
    { requiresSession = false }: { requiresSession?: boolean } = {}
  ): Promise<T> {
    try {
      return await firstValueFrom(call());
    } catch (error: unknown) {
      if (requiresSession && error instanceof HttpErrorResponse && error.status === 401) {
        await this.discardSession();
        throw new AuthFlowError('Your session has ended. Please sign in again.');
      }
      throw new AuthFlowError(describeHttpError(error));
    }
  }

  /** Runs a passkey ceremony, converting failures into user-facing messages. */
  private async runCeremony<T>(ceremony: () => Promise<T>): Promise<T> {
    try {
      return await ceremony();
    } catch (error: unknown) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'NotAllowedError' || name === 'AbortError') {
        throw new AuthFlowError('The passkey prompt was cancelled or timed out.');
      }
      if (name === 'InvalidStateError') {
        throw new AuthFlowError('This device already has a PokePaper passkey.');
      }
      throw new AuthFlowError(
        isNativePlatform()
          ? 'Passkeys are not available on this device.'
          : 'Passkeys are not available in this browser.'
      );
    }
  }
}

export function describeHttpError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return "Can't reach the server. Check your connection and try again.";
    }
    const message = (error.error as { error?: unknown } | null)?.error;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
    return `The server returned an error (${String(error.status)}).`;
  }
  return 'Something went wrong. Please try again.';
}
