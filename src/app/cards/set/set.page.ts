import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  ActionSheetController,
  IonBackButton,
  IonButton,
  IonButtons,
  IonCol,
  IonContent,
  IonGrid,
  IonHeader,
  IonIcon,
  IonProgressBar,
  IonRow,
  IonText,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular';
import type { CatalogCard, CatalogLanguage, CatalogRegion, CatalogSet } from '@pokepaper/shared';
import { addIcons } from 'ionicons';
import { cloudDoneOutline, cloudDownloadOutline } from 'ionicons/icons';
import { catalogKey, type StorageEngine } from '../../core/data/storage-engine';
import { StorageEngineFactory } from '../../core/data/storage-engine.factory';
import { localized } from '../../core/services/catalog-browse.service';
import {
  CatalogLanguageService,
  LANGUAGE_LABELS,
} from '../../core/services/catalog-language.service';
import { ImageDownloadService } from '../../core/services/image-download.service';
import { LayoutService, WIDE_LAYOUT_QUERY } from '../../core/services/layout.service';
import { CardDetailComponent } from '../../features/cards/card-detail.component';
import { cardText } from '../../features/cards/card-display';
import { CardImageComponent } from '../../features/cards/card-image.component';
import { LanguageButtonComponent } from '../../features/cards/language-button.component';

/** "SVI · 001/198" for a card in its set (bottom line of no-scan cards). */
export function setLine(set: CatalogSet, card: CatalogCard): string {
  const prefix = set.abbreviation ?? set.id;
  const total = set.cardCount.official > 0 ? `/${String(set.cardCount.official)}` : '';
  return `${prefix} · ${card.localId}${total}`;
}

/**
 * A set's cards (docs/ui.md → Cards): an IonGrid of card images with
 * "001 · Pineco" captions. The header has the language switch and the
 * download action; a card opens in the detail modal.
 */
@Component({
  selector: 'app-set',
  templateUrl: 'set.page.html',
  styles: [
    `
      .card-button {
        display: block;
        width: 100%;
        padding: 0;
        border: 0;
        background: none;
        cursor: pointer;
      }
      .caption {
        margin: 4px 0 8px;
        overflow: hidden;
        font-size: 0.75rem;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
  ],
  imports: [
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonTitle,
    IonButton,
    IonIcon,
    IonProgressBar,
    IonContent,
    IonGrid,
    IonRow,
    IonCol,
    IonText,
    CardImageComponent,
    LanguageButtonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetPage implements OnInit {
  private readonly storageEngineFactory = inject(StorageEngineFactory);
  private readonly catalogLanguage = inject(CatalogLanguageService);
  private readonly downloads = inject(ImageDownloadService);
  private readonly actionSheets = inject(ActionSheetController);
  private readonly modals = inject(ModalController);
  readonly layout = inject(LayoutService);

  /** Route parameters (component input binding). */
  readonly region = input.required<CatalogRegion>();
  readonly setId = input.required<string>();

  readonly set = signal<CatalogSet | null>(null);
  readonly cards = signal<CatalogCard[]>([]);
  readonly loaded = signal(false);

  readonly key = computed(() => catalogKey(this.region(), this.setId()));
  readonly language = computed<CatalogLanguage>(() =>
    this.catalogLanguage.forSet(this.region(), this.set()?.languages ?? [])
  );
  readonly title = computed(() => {
    const set = this.set();
    return set ? localized(set.names, this.language()) : '';
  });
  readonly progress = computed(() => this.downloads.progress().get(this.key()));
  readonly downloading = computed(() => this.progress()?.running ?? false);
  readonly downloaded = computed(() =>
    this.downloads.offlineSets().some((set) => set.setKey === this.key())
  );

  private get engine(): StorageEngine {
    return this.storageEngineFactory.getEngine();
  }

  constructor() {
    addIcons({ cloudDoneOutline, cloudDownloadOutline });
  }

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    const [sets, cards] = await Promise.all([
      this.engine.listCatalogSets(this.region()),
      this.engine.listCatalogCards(this.region(), this.setId()),
    ]);
    this.set.set(sets.find((stored) => stored.set.id === this.setId())?.set ?? null);
    this.cards.set(cards);
    this.loaded.set(true);
    void this.downloads.refresh();
  }

  name(card: CatalogCard): string {
    return cardText(card, this.language())?.name ?? card.id;
  }

  line(card: CatalogCard): string {
    const set = this.set();
    return set ? setLine(set, card) : card.localId;
  }

  pickLanguage(language: CatalogLanguage): void {
    void this.catalogLanguage.pick(this.region(), language);
  }

  async openDownloadActions(): Promise<void> {
    const set = this.set();
    if (!set) {
      return;
    }
    const current = this.language();
    const sheet = await this.actionSheets.create({
      header: this.downloaded() ? 'Downloaded for offline use' : 'Download images for offline use',
      buttons: [
        {
          text: `Download in ${LANGUAGE_LABELS[current].name}`,
          handler: () => void this.downloads.downloadSet(set.region, set.id, [current]),
        },
        ...(set.languages.length > 1
          ? [
              {
                text: 'Download in all languages',
                handler: () => void this.downloads.downloadSet(set.region, set.id, set.languages),
              },
            ]
          : []),
        ...(this.downloaded()
          ? [
              {
                text: 'Remove download',
                role: 'destructive',
                handler: () => void this.downloads.removeSet(this.key()),
              },
            ]
          : []),
        { text: 'Cancel', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  async openCard(index: number): Promise<void> {
    const set = this.set();
    if (!set) {
      return;
    }
    // A sheet on phones, a centered dialog on desktop (docs/ui.md).
    const sheet = !window.matchMedia(WIDE_LAYOUT_QUERY).matches;
    const modal = await this.modals.create({
      component: CardDetailComponent,
      componentProps: { setProp: set, cardsProp: this.cards(), startIndex: index },
      cssClass: 'card-detail-modal',
      ...(sheet ? { breakpoints: [0, 1], initialBreakpoint: 1, handle: true } : {}),
    });
    await modal.present();
  }
}
