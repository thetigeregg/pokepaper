import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  type OnInit,
  signal,
} from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSearchbar,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ModalController,
  ToastController,
} from '@ionic/angular';
import {
  cardmarketProductUrl,
  type CardmarketCandidate,
  type CardmarketCandidates,
  type CatalogCard,
  type CatalogLanguage,
  type CatalogSet,
} from '@pokepaper/shared';
import { addIcons } from 'ionicons';
import { checkmarkOutline, openOutline } from 'ionicons/icons';
import { CardmarketMatchService } from '../../core/services/cardmarket-match.service';
import { CurrencyService } from '../../core/services/currency.service';
import { headlinePrice } from '../../core/utils/catalog-price.util';
import { cardText, setLine } from './card-display';
import { CardImageComponent } from './card-image.component';

/** How the matcher closes: `match` or `clear` after a change, else `cancel`. */
export type CardmarketMatcherRole = 'match' | 'clear' | 'cancel';

type LoadState = 'loading' | 'ready' | 'offline' | 'unavailable' | 'error';

/**
 * Card detail's "Find on Cardmarket" sheet (docs/ui.md → Card detail;
 * docs/catalog.md → Matching by hand): the card, its current product, and
 * Cardmarket products to match it to, suggested or searched. Each links to
 * its Cardmarket page, where its scan and number tell printings apart.
 * Matching or removing the match closes the sheet (`CardmarketMatcherRole`).
 */
@Component({
  selector: 'app-cardmarket-matcher',
  templateUrl: 'cardmarket-matcher.component.html',
  styles: [
    `
      .thumb {
        flex-shrink: 0;
        width: 40px;
      }
    `,
  ],
  imports: [
    DatePipe,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonButton,
    IonTitle,
    IonSearchbar,
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
    IonIcon,
    IonSpinner,
    CardImageComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardmarketMatcherComponent implements OnInit {
  private readonly matches = inject(CardmarketMatchService);
  private readonly currencyService = inject(CurrencyService);
  private readonly modals = inject(ModalController);
  private readonly toasts = inject(ToastController);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  // Set through ModalController componentProps, which assigns plain
  // properties (docs/ui.md → Tests).
  cardProp!: CatalogCard;
  setProp!: CatalogSet;
  /** The language the card is shown in: names it, and filters Cardmarket's offers. */
  languageProp!: CatalogLanguage;

  readonly query = signal('');
  readonly state = signal<LoadState>('loading');
  readonly result = signal<CardmarketCandidates | null>(null);
  /** A match is being saved or removed. */
  readonly busy = signal(false);
  readonly current = computed(() => this.result()?.current ?? null);
  /** Each request's number: answers to older ones are dropped. */
  private request = 0;

  constructor() {
    addIcons({ checkmarkOutline, openOutline });
  }

  ngOnInit(): void {
    void this.load();
  }

  get name(): string {
    return cardText(this.cardProp, this.languageProp)?.name ?? this.cardProp.id;
  }

  get line(): string {
    return setLine(this.setProp, this.cardProp);
  }

  search(event: Event): void {
    const value = (event as CustomEvent<{ value?: string | null }>).detail.value ?? '';
    this.query.set(value);
    void this.load();
  }

  async load(): Promise<void> {
    const request = ++this.request;
    this.state.set('loading');
    try {
      const result = await this.matches.candidates(
        this.cardProp.region,
        this.cardProp.id,
        this.query()
      );
      if (request === this.request) {
        this.result.set(result);
        this.state.set('ready');
      }
    } catch (error: unknown) {
      if (request === this.request) {
        this.state.set(loadFailure(error));
      }
    }
  }

  /** The product's headline price in the picked currency: base finish, else reverse holo. */
  price(product: CardmarketCandidate): string | null {
    const figures = product.prices?.base ?? product.prices?.reverseHolo;
    const euros = figures ? headlinePrice(figures) : null;
    return euros === null ? null : this.currencyService.format(euros);
  }

  /** The product's Cardmarket page, offers filtered to the card's language. */
  url(idProduct: number): string {
    return cardmarketProductUrl(idProduct, { language: this.languageProp });
  }

  async match(product: CardmarketCandidate): Promise<void> {
    await this.change('match', () =>
      this.matches.match(this.cardProp.region, this.cardProp.id, product.idProduct)
    );
  }

  async clear(): Promise<void> {
    await this.change('clear', () => this.matches.clear(this.cardProp.region, this.cardProp.id));
  }

  close(): void {
    void this.dismiss('cancel');
  }

  private async change(role: 'match' | 'clear', save: () => Promise<void>): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      await save();
    } catch (error: unknown) {
      console.error('catalog.cardmarket_match_failed', error);
      this.busy.set(false);
      const toast = await this.toasts.create({
        message: "Couldn't save the match. Try again.",
        color: 'danger',
        duration: 3000,
        position: 'bottom',
      });
      await toast.present();
      return;
    }
    await this.dismiss(role);
  }

  /** Closes this modal: its own, not just the top one. */
  private dismiss(role: CardmarketMatcherRole): Promise<boolean> {
    const modal = this.host.nativeElement.closest('ion-modal');
    return modal ? modal.dismiss(undefined, role) : this.modals.dismiss(undefined, role);
  }
}

function loadFailure(error: unknown): LoadState {
  if (!navigator.onLine) {
    return 'offline';
  }
  return error instanceof HttpErrorResponse && error.status === 502 ? 'unavailable' : 'error';
}
