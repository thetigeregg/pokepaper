import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  AlertController,
  IonAccordion,
  IonAccordionGroup,
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonSearchbar,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import type { CatalogLanguage } from '@pokepaper/shared';
import { ImageDownloadService, type OfflineSet } from '../../core/services/image-download.service';
import { inLanguageOrder } from '../../core/utils/catalog-image.util';
import { describeBytes } from '../../features/catalog/catalog-section.component';
import { describeDownloads } from '../../features/catalog/images-section.component';

/** Downloaded sets of one series. */
export interface DownloadedSeries {
  key: string;
  name: string;
  languages: CatalogLanguage[];
  sets: OfflineSet[];
  bytes: number;
}

/** ['en', 'de'] → "EN DE". */
export function describeLanguages(languages: readonly CatalogLanguage[]): string {
  return languages.map((language) => language.toUpperCase()).join(' ');
}

/** Groups sets by series, keeping their order (newest series first when sets are newest first). */
export function groupBySeries(sets: readonly OfflineSet[]): DownloadedSeries[] {
  const groups = new Map<string, DownloadedSeries>();
  for (const set of sets) {
    const group = groups.get(set.serieKey) ?? {
      key: set.serieKey,
      name: set.serieName,
      languages: [],
      sets: [],
      bytes: 0,
    };
    group.sets.push(set);
    group.bytes += set.bytes;
    group.languages = inLanguageOrder([...group.languages, ...set.languages]);
    groups.set(set.serieKey, group);
  }
  return [...groups.values()];
}

/** Case- and accent-insensitive search key. */
function normalize(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Settings → Downloaded sets: every set downloaded for offline use, grouped
 * by series in collapsible rows, with search and removal per set, per
 * series, or all at once (docs/catalog.md → Images on the device).
 */
@Component({
  selector: 'app-downloads',
  templateUrl: 'downloads.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonTitle,
    IonSearchbar,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonNote,
    IonButton,
    IonAccordionGroup,
    IonAccordion,
  ],
})
export class DownloadsPage implements OnInit {
  private readonly downloads = inject(ImageDownloadService);
  private readonly alerts = inject(AlertController);

  readonly query = signal('');
  readonly busy = signal(false);
  /** Series the user expanded (while not searching). */
  private readonly expanded = signal<string[]>([]);

  readonly totals = computed(() => describeDownloads(this.downloads.totals()));
  readonly hasDownloads = computed(() => this.downloads.totals().sets > 0);

  readonly groups = computed(() => {
    const query = normalize(this.query().trim());
    const sets = query
      ? this.downloads
          .offlineSets()
          .filter(
            (set) => normalize(set.name).includes(query) || normalize(set.serieName).includes(query)
          )
      : this.downloads.offlineSets();
    return groupBySeries(sets);
  });

  /** While searching, every matching series is open. */
  readonly openSeries = computed(() =>
    this.query().trim() ? this.groups().map((group) => group.key) : this.expanded()
  );

  readonly describeLanguages = describeLanguages;
  readonly describeBytes = describeBytes;

  ngOnInit(): void {
    void this.downloads.refresh();
  }

  onSearch(value: string | null | undefined): void {
    this.query.set(value ?? '');
  }

  onToggle(value: string | string[] | null | undefined): void {
    if (!this.query().trim()) {
      this.expanded.set(Array.isArray(value) ? value : value ? [value] : []);
    }
  }

  async removeSet(set: OfflineSet): Promise<void> {
    await this.run(() => this.downloads.removeSet(set.setKey));
  }

  async removeSeries(group: DownloadedSeries, event?: Event): Promise<void> {
    event?.stopPropagation(); // Don't toggle the accordion.
    const count = group.sets.length;
    if (
      await this.confirm(
        `Remove ${group.name}?`,
        `${String(count)} downloaded ${count === 1 ? 'set' : 'sets'} (${describeBytes(group.bytes)}) will no longer be kept offline.`
      )
    ) {
      await this.run(() => this.downloads.removeSets(group.sets.map((set) => set.setKey)));
    }
  }

  async removeAll(): Promise<void> {
    if (
      await this.confirm(
        'Remove all downloads?',
        `${this.totals()} will no longer be kept offline. Images you view again are downloaded as needed.`
      )
    ) {
      await this.run(() =>
        this.downloads.removeSets(this.downloads.offlineSets().map((set) => set.setKey))
      );
    }
  }

  private async confirm(header: string, message: string): Promise<boolean> {
    const alert = await this.alerts.create({
      header,
      message,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Remove', role: 'confirm', cssClass: 'alert-button-danger' },
      ],
    });
    await alert.present();
    return (await alert.onDidDismiss()).role === 'confirm';
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
