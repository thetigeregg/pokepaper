import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import {
  AlertController,
  IonBadge,
  IonButton,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
} from '@ionic/angular';
import type { CatalogCard, CatalogLanguage, CatalogSet } from '@pokepaper/shared';
import { addIcons } from 'ionicons';
import { informationCircleOutline } from 'ionicons/icons';
import { LANGUAGE_LABELS } from '../../core/services/catalog-language.service';
import { CollectionService } from '../../core/services/collection.service';
import {
  cardText,
  cardVariants,
  collectionTarget,
  setLine,
  variantRows,
  type VariantRow,
} from './card-display';
import { CardImageComponent } from './card-image.component';

interface ChecklistRow {
  card: CatalogCard;
  name: string;
  /** Set and number, for the no-scan stand-in. */
  setLine: string;
  variants: VariantRow[];
}

/**
 * A set as a checklist (docs/ui.md → Set page), for entering a collection
 * quickly: one row per card with a small scan per variant (TCGdex has one
 * scan per language, so each variant shows it, named underneath). A scan
 * toggles its variant between 0 and 1 copy in `language` (with more copies,
 * the card opens to edit them); owned ones carry the grid's count badge,
 * unowned ones are dimmed. A summary row has "Mark all owned".
 */
@Component({
  selector: 'app-set-checklist',
  styles: [
    `
      .variants {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: 12px;
        margin-top: 8px;
      }
      /* A variant: the card's scan, its name underneath. */
      .variant {
        position: relative;
        display: flex;
        flex-direction: column;
        width: 64px;
        padding: 0;
        border: 0;
        background: none;
        color: inherit;
        cursor: pointer;
      }
      .variant app-card-image {
        transition: opacity 0.15s;
      }
      .variant:not(.owned) app-card-image {
        opacity: 0.4;
      }
      .variant:disabled {
        cursor: default;
      }
      .count {
        position: absolute;
        top: 4px;
        right: 4px;
      }
      .open ion-icon {
        font-size: 30px;
      }
      .variant-label {
        display: block;
        margin-top: 4px;
        font-size: 0.7rem;
        line-height: 1.2;
        white-space: normal;
        text-align: center;
      }
    `,
  ],
  template: `
    <ion-list>
      <ion-item data-testid="checklist-summary">
        <ion-label>
          {{ owned() }} / {{ set().cardCount.total }} owned
          <p class="hint">In {{ languageName() }}</p>
        </ion-label>
        <ion-button
          slot="end"
          fill="clear"
          [disabled]="!ready() || missing().length === 0"
          (click)="markAll()"
          data-testid="mark-all"
        >
          Mark all owned
        </ion-button>
      </ion-item>
      @for (row of rows(); track row.card.id; let index = $index) {
        <ion-item lines="inset" [attr.data-testid]="'checklist-' + row.card.id">
          <ion-label>
            {{ row.card.localId }} · {{ row.name }}
            @if (row.card.rarity) {
              <p>{{ row.card.rarity }}</p>
            }
            <div class="variants">
              @for (variant of row.variants; track variant.variant) {
                <button
                  type="button"
                  class="variant"
                  [class.owned]="variant.quantity > 0"
                  [disabled]="!ready()"
                  role="checkbox"
                  [attr.aria-checked]="variant.quantity > 0"
                  [attr.aria-label]="variantLabel(row, variant)"
                  (click)="toggle(row, variant, index)"
                  [attr.data-testid]="'toggle-' + variant.variant"
                >
                  <app-card-image
                    [card]="row.card"
                    [language]="language()"
                    [setLine]="row.setLine"
                  />
                  @if (variant.quantity > 0) {
                    <ion-badge class="count" color="danger" aria-hidden="true">
                      {{ variant.quantity }}
                    </ion-badge>
                  }
                  <span class="variant-label">{{ variant.label }}</span>
                </button>
              }
            </div>
          </ion-label>
          <ion-button
            slot="end"
            fill="clear"
            class="open"
            (click)="opened.emit(index)"
            [attr.aria-label]="'Show ' + row.name"
            data-testid="open-card"
          >
            <ion-icon slot="icon-only" name="information-circle-outline"></ion-icon>
          </ion-button>
        </ion-item>
      }
    </ion-list>
  `,
  imports: [IonList, IonItem, IonLabel, IonButton, IonBadge, IonIcon, CardImageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetChecklistComponent {
  private readonly collection = inject(CollectionService);
  private readonly alerts = inject(AlertController);

  readonly cards = input.required<CatalogCard[]>();
  readonly set = input.required<CatalogSet>();
  readonly language = input.required<CatalogLanguage>();
  /** A card's index in `cards`, to open in the card modal. */
  readonly opened = output<number>();

  /** Toggles stay disabled until the collection has loaded (they'd count from 0). */
  readonly ready = this.collection.loaded;
  readonly languageName = computed(() => LANGUAGE_LABELS[this.language()].name);

  readonly rows = computed<ChecklistRow[]>(() => {
    const language = this.language();
    const set = this.set();
    return this.cards().map((card) => ({
      card,
      name: cardText(card, language)?.name ?? card.id,
      setLine: setLine(set, card),
      variants: variantRows(card, (variant) =>
        this.collection.quantity(collectionTarget(card, variant, language))
      ),
    }));
  });

  readonly owned = computed(() => {
    const set = this.set();
    return this.collection.ownedInSet(set.region, set.id, this.language());
  });

  /** Cards with no copy in the current language. */
  readonly missing = computed(() => {
    const language = this.language();
    return this.cards().filter(
      (card) => this.collection.cardTotal(card.region, card.id, language) === 0
    );
  });

  constructor() {
    addIcons({ informationCircleOutline });
  }

  variantLabel(row: ChecklistRow, variant: VariantRow): string {
    const copies = variant.quantity > 1 ? `, ${String(variant.quantity)} copies` : '';
    return `${row.name} ${variant.label}${copies}`;
  }

  /** 0 → 1 copy and 1 → 0; with more copies, opens the card to change them. */
  toggle(row: ChecklistRow, variant: VariantRow, index: number): void {
    if (variant.quantity > 1) {
      this.opened.emit(index);
      return;
    }
    const target = collectionTarget(row.card, variant.variant, this.language());
    this.collection.setQuantity(target, variant.quantity === 0 ? 1 : 0).catch((error: unknown) => {
      console.error('collection.toggle_failed', error);
    });
  }

  /**
   * After confirming, adds one copy of every card not owned in the current
   * language, in its first variant (usually Normal), saved together.
   */
  async markAll(): Promise<void> {
    const cards = this.missing();
    const language = this.language();
    if (cards.length === 0) {
      return;
    }
    const count = cards.length === 1 ? '1 card' : `${String(cards.length)} cards`;
    const alert = await this.alerts.create({
      header: 'Mark all owned?',
      message: `Adds one copy of the ${count} you don't own yet in ${LANGUAGE_LABELS[language].name}, in each card's first variant (usually Normal).`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Mark all', role: 'confirm' },
      ],
    });
    await alert.present();
    if ((await alert.onDidDismiss()).role !== 'confirm') {
      return;
    }
    try {
      await this.collection.setQuantities(
        cards.map((card) => ({
          target: collectionTarget(card, cardVariants(card)[0] ?? 'normal', language),
          quantity: 1,
        }))
      );
    } catch (error: unknown) {
      console.error('collection.mark_all_failed', error);
    }
  }
}
