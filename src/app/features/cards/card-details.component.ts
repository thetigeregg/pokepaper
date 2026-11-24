import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  IonButton,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  ModalController,
} from '@ionic/angular';
import {
  cardmarketProductUrl,
  MAX_COLLECTION_QUANTITY,
  type CatalogCard,
  type CatalogCardPrices,
  type CatalogLanguage,
  type CatalogSet,
  type CollectionTarget,
  type CollectionVariant,
} from '@pokepaper/shared';
import { addIcons } from 'ionicons';
import { addCircleOutline, openOutline, removeCircleOutline } from 'ionicons/icons';
import { catalogKey } from '../../core/data/storage-engine';
import { LANGUAGE_LABELS } from '../../core/services/catalog-language.service';
import { CatalogPriceService } from '../../core/services/catalog-price.service';
import { CurrencyService } from '../../core/services/currency.service';
import { CollectionService } from '../../core/services/collection.service';
import { LayoutService } from '../../core/services/layout.service';
import { displayImage } from '../../core/utils/catalog-image.util';
import {
  UNKNOWN_SET_REVERSE_HOLOS,
  type SetReverseHolos,
} from '../../core/utils/catalog-price.util';
import { POCKET_SERIES } from '../decks/deck-rules';
import {
  cardSubtitle,
  cardText,
  collectionTarget,
  listedVariants,
  offeredVariants,
  priceRows,
  type PriceRow,
  retreatCost,
  retreatLabel,
  setLine,
  variantRows,
} from './card-display';
import { CardImageComponent } from './card-image.component';
import { CardTextComponent } from './card-text.component';
import { CardmarketMatcherComponent } from './cardmarket-matcher.component';
import { EnergyIconComponent } from './energy-icon.component';
import { RarityIconComponent } from './rarity-icon.component';

/**
 * One card's scan and full text in `language` (docs/ui.md → Card detail):
 * an IonList with sections for abilities, attacks, weakness · resistance ·
 * retreat, the copies owned in `language` per variant (a stepper each),
 * details, and the Cardmarket price per finish (or, without one, a way to
 * match the card to a Cardmarket product by hand). Image above the text on
 * phones, beside it on desktop.
 */
@Component({
  selector: 'app-card-details',
  templateUrl: 'card-details.component.html',
  styleUrl: 'card-details.component.scss',
  imports: [
    DatePipe,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
    IonButton,
    IonIcon,
    CardImageComponent,
    CardTextComponent,
    EnergyIconComponent,
    RarityIconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardDetailsComponent {
  private readonly collection = inject(CollectionService);
  private readonly priceService = inject(CatalogPriceService);
  private readonly currencyService = inject(CurrencyService);
  private readonly modals = inject(ModalController);
  private readonly layout = inject(LayoutService);

  readonly card = input.required<CatalogCard>();
  readonly set = input.required<CatalogSet>();
  readonly language = input.required<CatalogLanguage>();

  readonly maxQuantity = MAX_COLLECTION_QUANTITY;
  /** Steppers stay disabled until the collection has loaded (they'd count from 0). */
  readonly ready = this.collection.loaded;
  readonly languageName = computed(() => LANGUAGE_LABELS[this.language()].name);
  /**
   * Copies owned in the current language per variant (`variantRows`). A
   * reverse holo TCGdex doesn't flag is offered once the set's cards have
   * been read (`offeredVariants`).
   */
  readonly variants = computed(() => {
    const card = this.card();
    const setHolos = this.setHolos();
    const offered = setHolos ? offeredVariants(card, this.set(), setHolos) : listedVariants(card);
    return variantRows(offered, (variant) => this.collection.quantity(this.target(variant)));
  });
  /** "2 in German · 1 in French": copies owned in the card's other languages. */
  readonly otherLanguages = computed(() => {
    const card = this.card();
    return this.collection
      .otherLanguages(card.region, card.id, this.language())
      .map((other) => `${String(other.quantity)} in ${LANGUAGE_LABELS[other.language].name}`)
      .join(' · ');
  });
  readonly text = computed(() => cardText(this.card(), this.language()));
  readonly subtitle = computed(() => cardSubtitle(this.card()));
  readonly setLine = computed(() => setLine(this.set(), this.card()));
  /** Whether the scan shown is another printing's (basic Energy; docs/catalog.md). */
  readonly borrowedScan = computed(
    () => displayImage(this.card(), this.language(), 'high')?.borrowed ?? false
  );
  /** Attacks: costs and damage from the card, names and effects in the language. */
  readonly attacks = computed(() =>
    this.card().attacks.map((attack, index) => ({
      ...attack,
      name: this.text()?.attacks[index]?.name ?? '',
      effect: this.text()?.attacks[index]?.effect ?? null,
    }))
  );
  /** The longest attack cost, for one shared cost column width. */
  readonly costSlots = computed(() =>
    Math.max(1, ...this.attacks().map((attack) => attack.cost.length))
  );
  readonly retreatCost = computed(() => retreatCost(this.card()));
  readonly retreatLabel = computed(() => retreatLabel(this.card()));
  /** The stored prices of the card they were read for (a slide's card can change). */
  private readonly loadedPrices = signal<{
    key: string;
    prices: CatalogCardPrices | undefined;
  } | null>(null);
  /** `setReverseHolos` of the set it was read for. */
  private readonly loadedSetHolos = signal<{ key: string; holos: SetReverseHolos } | null>(null);
  /** What the card's set tells about reverse holos, once read. */
  private readonly setHolos = computed(() => {
    const loaded = this.loadedSetHolos();
    const { region, setId } = this.card();
    return loaded?.key === catalogKey(region, setId) ? loaded.holos : null;
  });
  private readonly cardPrices = computed(() => {
    const loaded = this.loadedPrices();
    const card = this.card();
    return loaded?.key === catalogKey(card.region, card.id) ? loaded : null;
  });
  private readonly prices = computed(() => this.cardPrices()?.prices);
  /** The price comes from a Cardmarket product matched by hand (docs/catalog.md). */
  readonly matchedByHand = computed(() => this.prices()?.matchedByHand === true);
  /**
   * Offer to match the card to a Cardmarket product by hand: its prices have
   * been read and it has none, and it isn't a TCG Pocket card (digital only,
   * never on Cardmarket).
   */
  readonly offerMatch = computed(
    () => this.cardPrices() !== null && !this.prices() && this.set().serieId !== POCKET_SERIES
  );
  /** The Price section's rows, one per priced finish (`priceRows`). */
  readonly priceRows = computed(() => {
    const loaded = this.cardPrices();
    const setHolos = this.setHolos();
    return loaded && setHolos ? priceRows(this.card(), this.set(), loaded.prices, setHolos) : [];
  });
  readonly pricesUpdated = computed(() => this.prices()?.updated ?? null);
  /** The ECB rates' day when prices are converted from euros, else null. */
  readonly convertedOn = computed(() =>
    this.currencyService.currency() === 'EUR' ? null : (this.currencyService.rates()?.date ?? null)
  );
  /**
   * The card's Cardmarket page, offers filtered to its language: all
   * finishes (`base`) or reverse holos only. Null when its product ID isn't
   * known (packs aren't checked per card).
   */
  readonly cardmarketUrls = computed(() => {
    const id = this.prices()?.idProduct;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
      return null;
    }
    const language = this.language();
    return {
      base: cardmarketProductUrl(id, { language }),
      reverseHolo: cardmarketProductUrl(id, { language, reverseHolo: true }),
    } satisfies Record<PriceRow['finish'], string>;
  });
  readonly legal = computed(() => {
    const { standard, expanded } = this.card().legal;
    return [standard ? 'Standard' : null, expanded ? 'Expanded' : null].filter(Boolean).join(' · ');
  });

  constructor() {
    addIcons({ addCircleOutline, openOutline, removeCircleOutline });
    // Reads the card's prices, and again whenever a sync stores new ones.
    effect((onCleanup) => {
      const { region, id } = this.card();
      this.priceService.version();
      let stale = false;
      onCleanup(() => {
        stale = true;
      });
      this.priceService
        .prices(region, id)
        .then((prices) => {
          if (!stale) {
            this.loadedPrices.set({ key: catalogKey(region, id), prices });
          }
        })
        .catch((error: unknown) => {
          console.error('catalog.card_prices_failed', error);
        });
    });
    // Reads what the card's set tells about reverse holos, for the steppers
    // and the reverse holo price, apart from the prices so a failed price
    // read doesn't hide a stepper. Read again when a sync stores new prices,
    // as a sync that changes the set does too.
    effect((onCleanup) => {
      const { region, setId } = this.card();
      this.priceService.version();
      let stale = false;
      onCleanup(() => {
        stale = true;
      });
      // Can't reject: a failed read is caught first.
      void this.priceService
        .setReverseHolos(region, setId)
        .catch((error: unknown): SetReverseHolos => {
          // The base finish still shows; the reverse holo goes by the card alone.
          console.error('catalog.set_reverse_holos_failed', error);
          return UNKNOWN_SET_REVERSE_HOLOS;
        })
        .then((holos) => {
          if (!stale) {
            this.loadedSetHolos.set({ key: catalogKey(region, setId), holos });
          }
        });
    });
  }

  /**
   * Opens the Cardmarket matcher (a sheet on phones, a dialog on desktop).
   * A change it saves syncs the card's new prices, which then show here.
   */
  async findOnCardmarket(): Promise<void> {
    const sheet = !this.layout.wide();
    const modal = await this.modals.create({
      component: CardmarketMatcherComponent,
      componentProps: {
        cardProp: this.card(),
        setProp: this.set(),
        languageProp: this.language(),
      },
      ...(sheet ? { breakpoints: [0, 0.75, 1], initialBreakpoint: 1, handle: true } : {}),
    });
    await modal.present();
  }

  /** A price in euros, in the currency picked in Settings ("CHF 0.13"). */
  money(euros: number): string {
    return this.currencyService.format(euros);
  }

  /** Adds (`+1`) or removes (`-1`) a copy of `variant` in the current language. */
  step(variant: CollectionVariant, delta: 1 | -1): void {
    const target = this.target(variant);
    const quantity = Math.min(
      MAX_COLLECTION_QUANTITY,
      Math.max(0, this.collection.quantity(target) + delta)
    );
    this.collection.setQuantity(target, quantity).catch((error: unknown) => {
      console.error('collection.step_failed', error);
    });
  }

  private target(variant: CollectionVariant): CollectionTarget {
    return collectionTarget(this.card(), variant, this.language());
  }
}
