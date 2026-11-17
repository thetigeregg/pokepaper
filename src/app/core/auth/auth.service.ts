import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type {
  AuthStatusResponse,
  ClientKind,
  CredentialSummary,
  RegisterVerifyResponse,
  SessionSummary,
} from '@pokepaper/shared';
import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { firstValueFrom, type Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SyncService } from '../services/sync.service';
import { PreferenceStorageService } from '../storage/preference-storage.service';

/** Local marker: this device has signed in and hasn't since been told the session ended. */
export const SIGNED_IN_KEY = 'pokepaper.auth.signedIn';

/**
 * The web app authenticates with an httpOnly session cookie. The iOS client
 * (`'ios'`, bearer token in the Keychain) is wired up with the native shell.
 */
const CLIENT: ClientKind = 'web';

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
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly preferences = inject(PreferenceStorageService);
  private readonly syncService = inject(SyncService);

  private readonly _signedIn = signal(false);
  readonly signedIn = this._signedIn.asReadonly();

  constructor() {
    effect(() => {
      if (this.syncService.status() === 'unauthorized' && this._signedIn()) {
        void this.endLocalSession();
      }
    });
  }

  /** Loads the local marker. Runs in an app initializer, before the first navigation. */
  async initialize(): Promise<void> {
    this._signedIn.set((await this.preferences.getItem(SIGNED_IN_KEY)) === 'true');
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
    const response = await this.runCeremony(() => startRegistration({ optionsJSON }));
    await this.request(() =>
      this.http.post<RegisterVerifyResponse>(this.url('/register/verify'), {
        response,
        setupToken,
        label,
        client: CLIENT,
      })
    );
    await this.markSignedIn();
  }

  async signIn(): Promise<void> {
    const optionsJSON = await this.request(() =>
      this.http.post<PublicKeyCredentialRequestOptionsJSON>(this.url('/login/options'), {})
    );
    const response = await this.runCeremony(() => startAuthentication({ optionsJSON }));
    await this.request(() =>
      this.http.post(this.url('/login/verify'), { response, client: CLIENT })
    );
    await this.markSignedIn();
  }

  /** Marks this device signed in when the server already recognizes its session (e.g. a surviving cookie). */
  async adoptExistingSession(): Promise<void> {
    await this.markSignedIn();
  }

  /** Adds another passkey to the signed-in account. */
  async addPasskey(label: string): Promise<CredentialSummary> {
    const optionsJSON = await this.request(() =>
      this.http.post<PublicKeyCredentialCreationOptionsJSON>(this.url('/register/options'), {})
    );
    const response = await this.runCeremony(() => startRegistration({ optionsJSON }));
    const result = await this.request(() =>
      this.http.post<RegisterVerifyResponse>(this.url('/register/verify'), {
        response,
        label,
        client: CLIENT,
      })
    );
    return result.credential;
  }

  listPasskeys(): Promise<CredentialSummary[]> {
    return this.request(() => this.http.get<CredentialSummary[]>(this.url('/credentials')));
  }

  async removePasskey(id: string): Promise<void> {
    await this.request(() => this.http.delete(this.url(`/credentials/${encodeURIComponent(id)}`)));
  }

  listSessions(): Promise<SessionSummary[]> {
    return this.request(() => this.http.get<SessionSummary[]>(this.url('/sessions')));
  }

  async revokeSession(id: string): Promise<void> {
    await this.request(() => this.http.delete(this.url(`/sessions/${encodeURIComponent(id)}`)));
  }

  /**
   * Ends the server session (best effort: works offline too) and returns to
   * the sign-in screen. Local data and queued changes are kept.
   */
  async signOut(): Promise<void> {
    try {
      await firstValueFrom(this.http.post(this.url('/logout'), {}));
    } catch {
      // Offline or already expired: the local sign-out below still applies.
    }
    await this.endLocalSession();
  }

  private async markSignedIn(): Promise<void> {
    await this.preferences.setItem(SIGNED_IN_KEY, 'true');
    this._signedIn.set(true);
    void this.syncService.resumeAfterReauth();
  }

  private async endLocalSession(): Promise<void> {
    this._signedIn.set(false);
    await this.preferences.removeItem(SIGNED_IN_KEY);
    await this.router.navigateByUrl('/login');
  }

  private url(path: string): string {
    return `${environment.apiUrl}/api/auth${path}`;
  }

  /** Runs an API call, converting HTTP failures into user-facing messages. */
  private async request<T>(call: () => Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(call());
    } catch (error: unknown) {
      throw new AuthFlowError(describeHttpError(error));
    }
  }

  /** Runs a WebAuthn browser ceremony, converting failures into user-facing messages. */
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
      throw new AuthFlowError('Passkeys are not available in this browser.');
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
