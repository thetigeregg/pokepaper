import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import {
  AlertController,
  IonBadge,
  IonButton,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
} from '@ionic/angular';
import type { CredentialSummary, SessionSummary } from '@pokepaper/shared';
import { AuthFlowError, AuthService } from '../../core/auth/auth.service';

/** Settings section: passkeys, signed-in devices, and sign-out. Needs a connection. */
@Component({
  selector: 'app-account-section',
  templateUrl: 'account-section.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, IonList, IonListHeader, IonItem, IonLabel, IonNote, IonButton, IonBadge],
})
export class AccountSectionComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly alerts = inject(AlertController);

  readonly passkeys = signal<CredentialSummary[]>([]);
  readonly sessions = signal<SessionSummary[]>([]);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    await this.run(async () => {
      const [passkeys, sessions] = await Promise.all([
        this.auth.listPasskeys(),
        this.auth.listSessions(),
      ]);
      this.passkeys.set(passkeys);
      this.sessions.set(sessions);
      this.loaded.set(true);
    });
  }

  async addPasskey(): Promise<void> {
    const label = await this.prompt('Name this passkey', 'e.g. iPhone, MacBook');
    if (label === null) {
      return;
    }
    await this.run(async () => {
      await this.auth.addPasskey(label.trim() || 'Passkey');
      await this.reload();
    });
  }

  async removePasskey(passkey: CredentialSummary): Promise<void> {
    if (
      !(await this.confirm(
        `Remove "${passkey.label}"?`,
        'Devices signed in with this passkey will be signed out.',
        'Remove'
      ))
    ) {
      return;
    }
    await this.run(async () => {
      await this.auth.removePasskey(passkey.id);
      await this.reload();
    });
  }

  async revokeSession(session: SessionSummary): Promise<void> {
    if (session.current) {
      await this.signOut();
      return;
    }
    if (!(await this.confirm('Sign out this device?', undefined, 'Sign out'))) {
      return;
    }
    await this.run(async () => {
      await this.auth.revokeSession(session.id);
      await this.reload();
    });
  }

  async signOut(): Promise<void> {
    if (
      await this.confirm(
        'Sign out of PokePaper?',
        'Your data stays on this device and syncs again after you sign back in.',
        'Sign out'
      )
    ) {
      await this.auth.signOut();
    }
  }

  private async reload(): Promise<void> {
    const [passkeys, sessions] = await Promise.all([
      this.auth.listPasskeys(),
      this.auth.listSessions(),
    ]);
    this.passkeys.set(passkeys);
    this.sessions.set(sessions);
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
    } catch (error: unknown) {
      this.error.set(error instanceof AuthFlowError ? error.message : 'Something went wrong.');
    } finally {
      this.busy.set(false);
    }
  }

  private async confirm(
    header: string,
    message: string | undefined,
    confirmText: string
  ): Promise<boolean> {
    const alert = await this.alerts.create({
      header,
      message,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: confirmText, role: 'confirm' },
      ],
    });
    await alert.present();
    return (await alert.onDidDismiss()).role === 'confirm';
  }

  private async prompt(header: string, placeholder: string): Promise<string | null> {
    const alert = await this.alerts.create({
      header,
      inputs: [{ name: 'label', type: 'text', placeholder, attributes: { maxlength: 60 } }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Continue', role: 'confirm' },
      ],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss<{ values?: { label?: string } }>();
    return role === 'confirm' ? (data?.values?.label ?? '') : null;
  }
}
