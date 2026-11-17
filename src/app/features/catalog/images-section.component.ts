import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSelect,
  IonSelectOption,
  NavController,
} from '@ionic/angular';
import {
  IMAGE_CACHE_LIMIT_OPTIONS_MB,
  ImageCacheService,
} from '../../core/services/image-cache.service';
import { ImageDownloadService } from '../../core/services/image-download.service';
import { describeBytes } from './catalog-section.component';

/** "214 sets · 3.1 GB", "1 set · 14 MB", or "None". */
export function describeDownloads(totals: { sets: number; bytes: number }): string {
  return totals.sets === 0
    ? 'None'
    : `${String(totals.sets)} ${totals.sets === 1 ? 'set' : 'sets'} · ${describeBytes(totals.bytes)}`;
}

/** 500 → "500 MB", 2000 → "2 GB". */
export function describeLimit(limitMb: number): string {
  return limitMb >= 1000 ? `${String(limitMb / 1000)} GB` : `${String(limitMb)} MB`;
}

/**
 * Settings section for card images on this device: space used by offline
 * sets and recently viewed images, the recently-viewed limit, and the list
 * of sets downloaded for offline use.
 */
@Component({
  selector: 'app-images-section',
  templateUrl: 'images-section.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonList, IonListHeader, IonItem, IonLabel, IonNote, IonSelect, IonSelectOption],
})
export class ImagesSectionComponent implements OnInit {
  private readonly imageCache = inject(ImageCacheService);
  private readonly downloads = inject(ImageDownloadService);
  private readonly nav = inject(NavController);

  readonly limitOptions = IMAGE_CACHE_LIMIT_OPTIONS_MB.map((value) => ({
    value,
    label: describeLimit(value),
  }));
  readonly limitMb = this.imageCache.limitMb;
  readonly busy = signal(false);

  /** "214 sets · 3.1 GB", or "None". */
  readonly downloadsSummary = computed(() => describeDownloads(this.downloads.totals()));
  readonly recentSize = computed(() => describeBytes(this.imageCache.usage()?.unpinnedBytes ?? 0));
  readonly hasRecent = computed(() => (this.imageCache.usage()?.unpinnedBytes ?? 0) > 0);

  ngOnInit(): void {
    void this.downloads.refresh();
  }

  openDownloads(): void {
    void this.nav.navigateForward('/tabs/settings/downloads');
  }

  async onLimitChange(limitMb: number): Promise<void> {
    await this.run(() => this.imageCache.setLimitMb(limitMb));
  }

  async clearRecent(): Promise<void> {
    await this.run(() => this.imageCache.clearRecentlyViewed());
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
    } finally {
      this.busy.set(false);
    }
  }
}
