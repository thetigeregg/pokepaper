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
import { catalogKey } from '../../core/data/storage-engine';
import { CatalogLanguageService } from '../../core/services/catalog-language.service';
import { cardText } from './card-display';
import { CardDetailsComponent } from './card-details.component';
import { LanguageButtonComponent } from './language-button.component';

/** Load more when the current card is this close to the last one loaded. */
export const LOAD_MORE_WITHIN = 5;

interface VirtualWindow {
  offset: number;
  from: number;
  slides: CatalogCard[];
}

/**
 * Card detail modal (docs/ui.md → Card detail). Swiper (the agreed non-stock
 * exception) pages through a set's cards, or search results from many sets,
 * rendering only the slides near the current one (virtual slides); arrow
 * keys page on desktop. The language button switches every card in the
 * catalog, and is remembered.
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
  /** The set every card is in (a set page)… */
  setProp: CatalogSet | null = null;
  /** …or each card's set by `region:setId` (search results). */
  setsProp: ReadonlyMap<string, CatalogSet> | null = null;
  cardsProp: CatalogCard[] = [];
  startIndex = 0;
  /**
   * Loads more cards to page through (search results load in pages),
   * resolving to every card loaded so far; absent for a set, which is whole.
   */
  loadMoreProp: (() => Promise<CatalogCard[]>) | null = null;
  private loadingMore = false;

  /** Null until ngOnInit copies the modal's props. */
  private readonly sets = signal<{
    one: CatalogSet | null;
    byKey: ReadonlyMap<string, CatalogSet> | null;
  }>({ one: null, byKey: null });
  readonly cards = signal<CatalogCard[]>([]);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private swiper: Swiper | null = null;

  readonly index = signal(0);
  readonly window = signal<VirtualWindow>({ offset: 0, from: 0, slides: [] });

  ngOnInit(): void {
    this.sets.set({ one: this.setProp, byKey: this.setsProp });
    this.cards.set(this.cardsProp);
    this.index.set(this.startIndex);
  }
  readonly current = computed(() => this.cards().at(this.index()));
  /** The current card's set, for the header's language button. */
  readonly set = computed(() => {
    const card = this.current();
    return card ? this.setFor(card) : null;
  });
  readonly language = computed<CatalogLanguage>(() => {
    const card = this.current();
    return card ? this.languageFor(card) : DEFAULT_CATALOG_LANGUAGES.intl;
  });
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
          void this.loadMoreIfNearEnd();
        },
      },
    });
    void this.loadMoreIfNearEnd(); // It may open near the end.
  }

  /**
   * Near the last card loaded, loads the next page and appends it to the
   * virtual slides, so paging carries on through all the results.
   */
  private async loadMoreIfNearEnd(): Promise<void> {
    const loadMore = this.loadMoreProp;
    if (!loadMore || this.loadingMore || this.index() < this.cards().length - LOAD_MORE_WITHIN) {
      return;
    }
    this.loadingMore = true;
    try {
      const cards = await loadMore();
      const added = cards.slice(this.cards().length);
      const swiper = this.swiper;
      if (added.length > 0 && swiper) {
        const at = swiper.activeIndex;
        this.cards.set(cards);
        swiper.virtual.appendSlide(added);
        // Appending re-reads the active slide from the slide position, which
        // just after opening isn't set yet (so it reads 0): stay put.
        if (swiper.activeIndex !== at) {
          swiper.slideTo(at, 0, false);
          this.index.set(at);
        }
      }
    } catch (error: unknown) {
      console.error('catalog.card_detail_load_more_failed', error);
    } finally {
      this.loadingMore = false;
    }
  }

  ngOnDestroy(): void {
    this.swiper?.destroy(true, false);
  }

  setFor(card: CatalogCard): CatalogSet | null {
    const { one, byKey } = this.sets();
    return byKey?.get(catalogKey(card.region, card.setId)) ?? one;
  }

  /** The catalog's remembered language, if the card's set has it. */
  languageFor(card: CatalogCard): CatalogLanguage {
    const set = this.setFor(card);
    return this.catalogLanguage.forSet(card.region, set?.languages ?? []);
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
