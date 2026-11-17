import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import {
  IonIcon,
  IonItem,
  IonItemDivider,
  IonItemGroup,
  IonLabel,
  IonList,
  IonProgressBar,
  IonThumbnail,
} from '@ionic/angular';
import type { CatalogSet } from '@pokepaper/shared';
import { catalogKey } from '../../core/data/storage-engine';
import { CatalogBrowseService, localized } from '../../core/services/catalog-browse.service';
import { CatalogSyncService } from '../../core/services/catalog-sync.service';
import { ImageDownloadService } from '../../core/services/image-download.service';
import { SetLogoComponent } from './set-logo.component';
import { addIcons } from 'ionicons';
import { cloudDoneOutline } from 'ionicons/icons';

/**
 * The current catalog's sets, grouped by series under sticky
 * IonItemDividers, newest first (docs/ui.md → Cards).
 */
@Component({
  selector: 'app-sets-list',
  templateUrl: 'sets-list.component.html',
  imports: [
    DatePipe,
    IonList,
    IonItemGroup,
    IonItemDivider,
    IonItem,
    IonThumbnail,
    IonLabel,
    IonIcon,
    IonProgressBar,
    SetLogoComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetsListComponent implements OnInit {
  constructor() {
    addIcons({ cloudDoneOutline });
  }

  readonly browse = inject(CatalogBrowseService);
  private readonly catalogSync = inject(CatalogSyncService);
  private readonly downloads = inject(ImageDownloadService);

  /** The set shown next to the list (desktop), highlighted. */
  readonly selectedKey = input<string | null>(null);
  readonly selected = output<CatalogSet>();

  readonly progress = this.catalogSync.progress;
  readonly syncStatus = this.catalogSync.status;
  readonly downloaded = computed(
    () => new Set(this.downloads.offlineSets().map((set) => set.setKey))
  );

  ngOnInit(): void {
    void this.downloads.refresh();
  }

  key(set: CatalogSet): string {
    return catalogKey(set.region, set.id);
  }

  name(set: CatalogSet): string {
    return localized(set.names, this.browse.language());
  }
}
