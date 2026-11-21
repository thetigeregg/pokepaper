import { CurrencyPipe, DatePipe } from '@angular/common';
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
import { CollectionService } from '../../core/services/collection.service';
import { displayImage } from '../../core/utils/catalog-image.util';
import {
  cardSubtitle,
  cardText,
  collectionTarget,
  priceRows,
  retreatCost,
  retreatLabel,
  setLine,
  variantRows,
} from './card-display';
import { CardImageComponent } from './card-image.component';
import { CardTextComponent } from './card-text.component';
import { EnergyIconComponent } from './energy-icon.component';
import { RarityIconComponent } from './rarity-icon.component';

/**
 * One card's scan and full text in `language` (docs/ui.md → Card detail):
 * an IonList with sections for abilities, attacks, weakness · resistance ·
 * retreat, the copies owned in `language` per variant (a stepper each),
 * details, and the Cardmarket price per finish. Image above the text on phones, beside it on desktop.
 */
@Component({
  selector: 'app-card-details',
  templateUrl: 'card-details.component.html',
  styleUrl: 'card-details.component.scss',
  imports: [
    CurrencyPipe,
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

  readonly card = input.required<CatalogCard>();
  readonly set = input.required<CatalogSet>();
  readonly language = input.required<CatalogLanguage>();

  readonly maxQuantity = MAX_COLLECTION_QUANTITY;
  /** Steppers stay disabled until the collection has loaded (they'd count from 0). */
  readonly ready = this.collection.loaded;
  readonly languageName = computed(() => LANGUAGE_LABELS[this.language()].name);
  /** Copies owned in the current language per variant (`variantRows`). */
  readonly variants = computed(() =>
    variantRows(this.card(), (variant) => this.collection.quantity(this.target(variant)))
  );
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
  private readonly prices = computed(() => {
    const loaded = this.loadedPrices();
    const card = this.card();
    return loaded?.key === catalogKey(card.region, card.id) ? loaded.prices : undefined;
  });
  /** The Price section's rows, one per priced finish (`priceRows`). */
  readonly priceRows = computed(() => priceRows(this.card(), this.set(), this.prices()));
  readonly pricesUpdated = computed(() => this.prices()?.updated ?? null);
  /** The card's Cardmarket page, when its product ID is known (packs aren't checked per card). */
  readonly cardmarketUrl = computed(() => {
    const id = this.prices()?.idProduct;
    return typeof id === 'number' && Number.isSafeInteger(id) && id > 0
      ? cardmarketProductUrl(id)
      : null;
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
