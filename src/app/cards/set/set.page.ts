import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  ActionSheetController,
  IonBackButton,
  IonButtons,
  IonCol,
  IonContent,
  IonGrid,
  IonHeader,
  IonProgressBar,
  IonRow,
  IonText,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular';
import type { CatalogCard, CatalogLanguage, CatalogRegion, CatalogSet } from '@pokepaper/shared';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { addIcons } from 'ionicons';
import { debounceTime } from 'rxjs';
import { cloudDoneOutline, cloudDownloadOutline, gridOutline, listOutline } from 'ionicons/icons';
import { catalogKey, type StorageEngine } from '../../core/data/storage-engine';
import { StorageEngineFactory } from '../../core/data/storage-engine.factory';
import { CatalogBrowseService, localized } from '../../core/services/catalog-browse.service';
import {
  CatalogLanguageService,
  LANGUAGE_LABELS,
} from '../../core/services/catalog-language.service';
import { CatalogSyncService } from '../../core/services/catalog-sync.service';
import { ImageDownloadService } from '../../core/services/image-download.service';
import { LayoutService } from '../../core/services/layout.service';
import { CardDetailComponent } from '../../features/cards/card-detail.component';
import { cardText, setLine } from '../../features/cards/card-display';
import { CardTileComponent } from '../../features/cards/card-tile.component';
import {
  HeaderActionsComponent,
  type HeaderAction,
} from '../../features/common/header-actions.component';
import { LanguageButtonComponent } from '../../features/cards/language-button.component';
import { SetChecklistComponent } from '../../features/cards/set-checklist.component';
import { SetLogoComponent } from '../../features/cards/set-logo.component';

/**
 * A set's cards (docs/ui.md → Cards): an IonGrid of card images with
 * "001 · Pineco" captions, or a checklist for collecting (the view is
 * remembered on the device). The header has the language switch, then the
 * view switch and the download action (in a More menu on phones); a card
 * opens in the detail modal.
 */
@Component({
  selector: 'app-set',
  templateUrl: 'set.page.html',
  imports: [
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonTitle,
    IonProgressBar,
    IonContent,
    IonGrid,
    IonRow,
    IonCol,
    IonText,
    CardTileComponent,
    HeaderActionsComponent,
    LanguageButtonComponent,
    SetChecklistComponent,
    SetLogoComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetPage implements OnInit {
  private readonly storageEngineFactory = inject(StorageEngineFactory);
  private readonly catalogLanguage = inject(CatalogLanguageService);
  private readonly downloads = inject(ImageDownloadService);
  private readonly actionSheets = inject(ActionSheetController);
  private readonly modals = inject(ModalController);
  private readonly catalogSync = inject(CatalogSyncService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly browse = inject(CatalogBrowseService);
  readonly layout = inject(LayoutService);

  /** Route parameters (component input binding). */
  readonly region = input.required<CatalogRegion>();
  readonly setId = input.required<string>();

  readonly set = signal<CatalogSet | null>(null);
  readonly cards = signal<CatalogCard[]>([]);
  readonly loaded = signal(false);
  /** Grid or checklist, shared by every set page (`CatalogBrowseService.setView`). */
  readonly view = this.browse.setView;

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
  /** The header's view switch and download action, after the language button. */
  readonly actions = computed<HeaderAction[]>(() => [
    this.view() === 'grid'
      ? {
          id: 'view',
          label: 'Show as checklist',
          icon: 'list-outline',
          run: () => void this.toggleView(),
        }
      : {
          id: 'view',
          label: 'Show as grid',
          icon: 'grid-outline',
          run: () => void this.toggleView(),
        },
    {
      id: 'download',
      label: this.downloaded() ? 'Downloaded for offline use' : 'Download images',
      icon: this.downloaded() ? 'cloud-done-outline' : 'cloud-download-outline',
      disabled: this.downloading(),
      run: () => void this.openDownloadActions(),
    },
  ]);

  private get engine(): StorageEngine {
    return this.storageEngineFactory.getEngine();
  }

  constructor() {
    addIcons({ cloudDoneOutline, cloudDownloadOutline, gridOutline, listOutline });
  }

  ngOnInit(): void {
    void this.load();
    void this.downloads.refresh(); // For the downloaded marker.
    // Follow catalog updates (the set's pack replaced, or arriving on first run).
    this.catalogSync.changed$
      .pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.load());
  }

  private async load(): Promise<void> {
    try {
      const [stored, cards] = await Promise.all([
        this.engine.getCatalogSet(this.region(), this.setId()),
        this.engine.listCatalogCards(this.region(), this.setId()),
      ]);
      this.set.set(stored?.set ?? null);
      this.cards.set(cards);
    } catch (error: unknown) {
      console.error('catalog.set_load_failed', error);
    } finally {
      this.loaded.set(true);
    }
  }

  /** Switches between the card grid and the checklist, remembered for every set. */
  toggleView(): Promise<void> {
    return this.browse.pickSetView(this.view() === 'grid' ? 'checklist' : 'grid');
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
    const sheet = !this.layout.wide();
    const modal = await this.modals.create({
      component: CardDetailComponent,
      componentProps: { setProp: set, cardsProp: this.cards(), startIndex: index },
      cssClass: 'card-detail-modal',
      ...(sheet ? { breakpoints: [0, 1], initialBreakpoint: 1, handle: true } : {}),
    });
    await modal.present();
  }
}
