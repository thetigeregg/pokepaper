import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular';
import {
  DEFAULT_CATALOG_LANGUAGES,
  type CatalogCard,
  type CatalogLanguage,
  type CatalogSet,
} from '@pokepaper/shared';
import Swiper from 'swiper';
import { Keyboard, Virtual } from 'swiper/modules';
import { CatalogLanguageService } from '../../core/services/catalog-language.service';
import { cardText } from './card-display';
import { CardDetailsComponent } from './card-details.component';
import { LanguageButtonComponent } from './language-button.component';

interface VirtualWindow {
  offset: number;
  from: number;
  slides: CatalogCard[];
}

/**
 * Card detail modal (docs/ui.md → Card detail). Swiper (the agreed non-stock
 * exception) pages through the set's cards, rendering only the slides near
 * the current one (virtual slides); arrow keys page on desktop. The language button switches every card, and is remembered.
 */
@Component({
  selector: 'app-card-detail',
  templateUrl: 'card-detail.component.html',
  styleUrl: 'card-detail.component.scss',
  imports: [
    IonHeader,
    IonToolbar,
    IonButtons,
    IonButton,
    IonTitle,
    IonContent,
    CardDetailsComponent,
    LanguageButtonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardDetailComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly modalController = inject(ModalController);
  private readonly catalogLanguage = inject(CatalogLanguageService);

  // Set through ModalController componentProps, which assigns plain
  // properties (signal inputs would be overwritten).
  setProp!: CatalogSet;
  cardsProp: CatalogCard[] = [];
  startIndex = 0;

  /** Null until ngOnInit copies the modal's props. */
  readonly set = signal<CatalogSet | null>(null);
  readonly cards = signal<CatalogCard[]>([]);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private swiper: Swiper | null = null;

  readonly index = signal(0);
  readonly window = signal<VirtualWindow>({ offset: 0, from: 0, slides: [] });
  readonly language = computed<CatalogLanguage>(() => {
    const set = this.set();
    return set
      ? this.catalogLanguage.forSet(set.region, set.languages)
      : DEFAULT_CATALOG_LANGUAGES.intl;
  });

  ngOnInit(): void {
    this.set.set(this.setProp);
    this.cards.set(this.cardsProp);
    this.index.set(this.startIndex);
  }
  readonly current = computed(() => this.cards().at(this.index()));
  readonly title = computed(() => {
    const card = this.current();
    return card ? (cardText(card, this.language())?.name ?? card.id) : '';
  });

  ngAfterViewInit(): void {
    const element = this.host.nativeElement.querySelector<HTMLElement>('.swiper');
    if (!element) {
      return;
    }
    this.swiper = new Swiper(element, {
      modules: [Virtual, Keyboard],
      initialSlide: this.startIndex,
      autoHeight: true,
      keyboard: { enabled: true },
      virtual: {
        slides: this.cards(),
        addSlidesBefore: 1,
        addSlidesAfter: 1,
        renderExternal: (data) => {
          this.window.set({
            offset: data.offset,
            from: data.from,
            slides: data.slides as CatalogCard[],
          });
          // Once Angular has rendered the window, let Swiper pick up the new
          // slide elements and size to the active one (as Swiper's own
          // framework wrappers do).
          requestAnimationFrame(() => {
            this.swiper?.updateSlides();
            this.swiper?.updateSlidesClasses();
            this.swiper?.updateAutoHeight(0);
          });
        },
      },
      on: {
        slideChange: (swiper) => {
          this.index.set(swiper.activeIndex);
        },
      },
    });
  }

  ngOnDestroy(): void {
    this.swiper?.destroy(true, false);
  }

  pickLanguage(language: CatalogLanguage): void {
    const set = this.set();
    if (set) {
      void this.catalogLanguage.pick(set.region, language);
    }
    requestAnimationFrame(() => this.swiper?.updateAutoHeight(0));
  }

  close(): void {
    void this.modalController.dismiss();
  }
}
