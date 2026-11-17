import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { DEFAULT_SETTINGS, type UserSettings } from '@pokepaper/shared';
import { LocalUserDataRepository } from '../core/data/local-user-data-repository';
import { SyncService, type SyncStatus } from '../core/services/sync.service';

/** Card languages offered in Settings. Codes follow TCGdex; the list is
 * revisited when the card catalog lands and real per-language coverage is known. */
export const CARD_LANGUAGES: readonly { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'zh-tw', label: '繁體中文' },
];

const SYNC_STATUS_LABELS: Record<SyncStatus, string> = {
  idle: 'Up to date',
  syncing: 'Syncing…',
  offline: 'Offline: changes are saved on this device',
  unauthorized: 'Signed out: sign in to resume syncing',
  error: 'Sync failed: will retry',
};

@Component({
  selector: 'app-settings',
  templateUrl: 'settings.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
    IonSelect,
    IonSelectOption,
  ],
})
export class SettingsPage implements OnInit {
  private readonly repository = inject(LocalUserDataRepository);
  private readonly syncService = inject(SyncService);

  readonly languages = CARD_LANGUAGES;
  readonly settings = signal<UserSettings>({ ...DEFAULT_SETTINGS });
  readonly syncStatusLabel = computed(() => SYNC_STATUS_LABELS[this.syncService.status()]);

  ngOnInit(): void {
    void this.loadSettings();
  }

  async loadSettings(): Promise<void> {
    this.settings.set(await this.repository.getSettings());
  }

  async onCardLanguageChange(cardLanguage: string): Promise<void> {
    const next: UserSettings = { ...this.settings(), cardLanguage };
    this.settings.set(next);
    await this.repository.updateSettings(next);
  }
}
