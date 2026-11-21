import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import {
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { AccountSectionComponent } from '../features/account/account-section.component';
import { CollectionValueSectionComponent } from '../features/collection/collection-value-section.component';
import { CatalogSectionComponent } from '../features/catalog/catalog-section.component';
import { ImagesSectionComponent } from '../features/catalog/images-section.component';
import { SyncService, type SyncStatus } from '../core/services/sync.service';

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
    AccountSectionComponent,
    CatalogSectionComponent,
    CollectionValueSectionComponent,
    ImagesSectionComponent,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
  ],
})
export class SettingsPage {
  private readonly syncService = inject(SyncService);

  readonly syncStatusLabel = computed(() => SYNC_STATUS_LABELS[this.syncService.status()]);
  readonly rejectedOperations = this.syncService.rejectedOperations;
}
