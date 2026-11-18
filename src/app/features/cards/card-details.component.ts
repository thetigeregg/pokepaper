import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
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
  MAX_COLLECTION_QUANTITY,
  type CatalogCard,
  type CatalogLanguage,
  type CatalogSet,
  type CollectionTarget,
  type CollectionVariant,
} from '@pokepaper/shared';
import { addIcons } from 'ionicons';
import { addCircleOutline, removeCircleOutline } from 'ionicons/icons';
import { LANGUAGE_LABELS } from '../../core/services/catalog-language.service';
import { CollectionService } from '../../core/services/collection.service';
import {
  VARIANT_LABELS,
  cardSubtitle,
  cardText,
  cardVariants,
  retreatCost,
  retreatLabel,
  setLine,
} from './card-display';
import { CardImageComponent } from './card-image.component';
import { CardTextComponent } from './card-text.component';
import { EnergyIconComponent } from './energy-icon.component';

/**
 * One card's scan and full text in `language` (docs/ui.md → Card detail):
 * an IonList with the copies owned in `language` per variant (a stepper
 * each), then sections for abilities, attacks, weakness · resistance ·
 * retreat, and details. Image above the text on phones, beside it on desktop.
 */
@Component({
  selector: 'app-card-details',
  templateUrl: 'card-details.component.html',
  styleUrl: 'card-details.component.scss',
  imports: [
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
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardDetailsComponent {
  private readonly collection = inject(CollectionService);

  readonly card = input.required<CatalogCard>();
  readonly set = input.required<CatalogSet>();
  readonly language = input.required<CatalogLanguage>();

  readonly maxQuantity = MAX_COLLECTION_QUANTITY;
  readonly languageName = computed(() => LANGUAGE_LABELS[this.language()].name);
  /** Copies owned in the current language, per variant the card comes in. */
  readonly variants = computed(() =>
    cardVariants(this.card()).map((variant) => ({
      variant,
      label: VARIANT_LABELS[variant],
      quantity: this.collection.quantity(this.target(variant)),
    }))
  );
  /** "2 in Deutsch · 1 in Français": copies owned in the set's other languages. */
  readonly otherLanguages = computed(() => {
    const card = this.card();
    return this.collection
      .otherLanguages(card.region, card.id, this.language(), this.set().languages)
      .map((other) => `${String(other.quantity)} in ${LANGUAGE_LABELS[other.language].name}`)
      .join(' · ');
  });

  readonly text = computed(() => cardText(this.card(), this.language()));
  readonly subtitle = computed(() => cardSubtitle(this.card()));
  readonly setLine = computed(() => setLine(this.set(), this.card()));
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
  readonly legal = computed(() => {
    const { standard, expanded } = this.card().legal;
    return [standard ? 'Standard' : null, expanded ? 'Expanded' : null].filter(Boolean).join(' · ');
  });

  constructor() {
    addIcons({ addCircleOutline, removeCircleOutline });
  }

  /** Adds (`+1`) or removes (`-1`) a copy of `variant` in the current language. */
  step(variant: CollectionVariant, delta: 1 | -1): void {
    const target = this.target(variant);
    const quantity = Math.min(
      MAX_COLLECTION_QUANTITY,
      Math.max(0, this.collection.quantity(target) + delta)
    );
    void this.collection.setQuantity(target, quantity);
  }

  private target(variant: CollectionVariant): CollectionTarget {
    const card = this.card();
    return {
      region: card.region,
      cardId: card.id,
      setId: card.setId,
      variant,
      language: this.language(),
    };
  }
}
