import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { AlertController, IonButton, IonIcon, IonItem, IonLabel, IonList } from '@ionic/angular';
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
 * quickly: one row per card with its scan (TCGdex has one per language;
 * it opens the card), "001 · Pineco", its rarity, and a toggle button per
 * variant underneath (0 ↔ 1 copy in `language`; with more copies, the card
 * opens to edit them). A summary row has "Mark all owned".
 */
@Component({
  selector: 'app-set-checklist',
  styles: [
    `
      /* The card's scan, leading the row like the sets list's logos; it opens the card. */
      .thumb {
        flex-shrink: 0;
        width: 52px;
        padding: 0;
        border: 0;
        background: none;
        cursor: pointer;
      }
      /* One toggle per variant, side by side under the name and rarity. */
      .variants {
        display: flex;
        flex-wrap: wrap;
        gap: 10px 8px;
        margin-top: 6px;
      }
      /* Desktop: two columns of cards, the summary across both. */
      @media (min-width: 992px) {
        ion-list {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .summary {
          grid-column: 1 / -1;
        }
      }
      .variants ion-button {
        margin: 0;
      }
      .open ion-icon {
        font-size: 24px;
      }
    `,
  ],
  template: `
    <ion-list>
      <ion-item class="summary" data-testid="checklist-summary">
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
            <div class="media-row">
              <button
                type="button"
                class="thumb"
                (click)="opened.emit(index)"
                [attr.aria-label]="'Show ' + row.name"
                data-testid="open-thumb"
              >
                <app-card-image [card]="row.card" [language]="language()" [setLine]="row.setLine" />
              </button>
              <div class="media-row-text">
                {{ row.card.localId }} · {{ row.name }}
                @if (row.card.rarity) {
                  <p>{{ row.card.rarity }}</p>
                }
                <div class="variants">
                  @for (variant of row.variants; track variant.variant) {
                    <ion-button
                      size="small"
                      [fill]="variant.quantity > 0 ? 'solid' : 'outline'"
                      [disabled]="!ready()"
                      [attr.aria-pressed]="variant.quantity > 0"
                      [attr.aria-label]="variantLabel(row, variant)"
                      (click)="toggle(row, variant, index)"
                      [attr.data-testid]="'toggle-' + variant.variant"
                    >
                      {{ variant.label }}
                      @if (variant.quantity > 1) {
                        ×{{ variant.quantity }}
                      }
                    </ion-button>
                  }
                </div>
              </div>
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
  imports: [IonList, IonItem, IonLabel, IonButton, IonIcon, CardImageComponent],
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
