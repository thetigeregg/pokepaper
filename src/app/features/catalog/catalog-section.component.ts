import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { IonItem, IonLabel, IonList, IonListHeader, IonNote, IonProgressBar } from '@ionic/angular';
import {
  CatalogSyncService,
  type CatalogSyncStatus,
} from '../../core/services/catalog-sync.service';
import { isNativePlatform } from '../../core/utils/native-platform.util';

const STATUS_LABELS: Record<CatalogSyncStatus, string> = {
  idle: 'Up to date',
  checking: 'Checking for updates…',
  downloading: 'Downloading…',
  offline: 'Offline: using the copy on this device',
  unauthorized: 'Sign in to update',
  error: 'Update failed: will retry',
};

const RELATIVE_TIME = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** "just now", "5 minutes ago", "yesterday", … */
export function describeAge(then: Date, now: Date): string {
  const seconds = Math.round((then.getTime() - now.getTime()) / 1000);
  if (seconds > -60) {
    return 'just now';
  }
  const minutes = Math.round(seconds / 60);
  if (minutes > -60) {
    return RELATIVE_TIME.format(minutes, 'minute');
  }
  const hours = Math.round(minutes / 60);
  if (hours > -24) {
    return RELATIVE_TIME.format(hours, 'hour');
  }
  return RELATIVE_TIME.format(Math.round(hours / 24), 'day');
}

/** 123456789 → "118 MB". */
export function describeBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${String(Math.round(bytes / (1024 * 1024)))} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Settings section for the card catalog kept on this device: download
 * status and progress, what's stored, when it was last checked, storage
 * used, and a manual "Check for updates".
 */
@Component({
  selector: 'app-catalog-section',
  templateUrl: 'catalog-section.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, IonList, IonListHeader, IonItem, IonLabel, IonNote, IonProgressBar],
})
export class CatalogSectionComponent implements OnInit {
  private readonly catalogSync = inject(CatalogSyncService);
  private readonly destroyRef = inject(DestroyRef);

  readonly status = this.catalogSync.status;
  readonly progress = this.catalogSync.progress;
  readonly stats = this.catalogSync.stats;
  readonly busy = computed(() => ['checking', 'downloading'].includes(this.status()));

  readonly statusLabel = computed(() => {
    const progress = this.progress();
    return this.status() === 'downloading' && progress
      ? `Downloading ${String(progress.done)} of ${String(progress.total)} sets`
      : STATUS_LABELS[this.status()];
  });

  /** Ticks every minute so "last checked" stays accurate while the page is open. */
  private readonly now = signal(new Date());
  readonly lastChecked = computed(() => {
    const checked = this.catalogSync.lastChecked();
    return checked ? describeAge(checked, this.now()) : 'Never';
  });

  /** Storage this site uses (web only; the iOS app doesn't report it). */
  readonly storageUsed = signal<string | null>(null);

  constructor() {
    // Re-measure storage whenever the stored catalog changes.
    effect(() => {
      this.stats();
      void this.measureStorage();
    });
  }

  ngOnInit(): void {
    const timer = window.setInterval(() => {
      this.now.set(new Date());
    }, 60_000);
    this.destroyRef.onDestroy(() => {
      window.clearInterval(timer);
    });
  }

  checkForUpdates(): void {
    void this.catalogSync.syncNow();
  }

  private async measureStorage(): Promise<void> {
    if (isNativePlatform() || !('storage' in navigator)) {
      return;
    }
    try {
      const { usage } = await navigator.storage.estimate();
      this.storageUsed.set(usage === undefined ? null : describeBytes(usage));
    } catch {
      this.storageUsed.set(null);
    }
  }
}
