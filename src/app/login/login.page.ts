import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonButton,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonList,
  IonNote,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { AuthFlowError, AuthService, describeHttpError } from '../core/auth/auth.service';

/**
 * - `loading`: asking the server what's possible
 * - `setup`: no passkey yet and setup is enabled: enter the setup token
 * - `setup-disabled`: no passkey yet and no setup token configured on the server
 * - `sign-in`: a passkey exists: sign in with it
 * - `unreachable`: the server can't be reached (e.g. offline before the first sign-in)
 */
export type LoginMode = 'loading' | 'setup' | 'setup-disabled' | 'sign-in' | 'unreachable';

@Component({
  selector: 'app-login',
  templateUrl: 'login.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonList,
    IonItem,
    IonInput,
    IonButton,
    IonNote,
    IonSpinner,
    IonText,
  ],
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly mode = signal<LoginMode>('loading');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly unreachableMessage = signal('');

  setupToken = '';
  passkeyLabel = 'My passkey';

  ionViewWillEnter(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.mode.set('loading');
    this.error.set(null);

    try {
      // A sign-out made offline must reach the server before a surviving
      // session cookie is allowed to count as "already signed in".
      const noPendingSignOut = await this.auth.completePendingSignOut();
      const status = await this.auth.status();
      if (status.authenticated && noPendingSignOut) {
        await this.auth.adoptExistingSession();
        await this.router.navigateByUrl('/tabs', { replaceUrl: true });
        return;
      }
      this.mode.set(
        status.registered ? 'sign-in' : status.setupAvailable ? 'setup' : 'setup-disabled'
      );
    } catch (error: unknown) {
      this.unreachableMessage.set(describeHttpError(error));
      this.mode.set('unreachable');
    }
  }

  signIn(): Promise<void> {
    return this.run(() => this.auth.signIn());
  }

  setUp(): Promise<void> {
    const token = this.setupToken.trim();
    if (!token) {
      this.error.set('Enter the setup token from the server.');
      return Promise.resolve();
    }
    return this.run(() => this.auth.setUp(token, this.passkeyLabel.trim() || 'My passkey'));
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
      await this.router.navigateByUrl('/tabs', { replaceUrl: true });
    } catch (error: unknown) {
      this.error.set(
        error instanceof AuthFlowError ? error.message : 'Something went wrong. Please try again.'
      );
    } finally {
      this.busy.set(false);
    }
  }
}
