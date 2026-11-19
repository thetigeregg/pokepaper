import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { IonBadge, IonButton, IonIcon, IonText } from '@ionic/angular';
import type { CatalogCard, CatalogLanguage } from '@pokepaper/shared';
import { addIcons } from 'ionicons';
import { informationCircleOutline } from 'ionicons/icons';
import { CollectionService } from '../../core/services/collection.service';
import { CardImageComponent } from './card-image.component';

/**
 * A card in a grid (docs/ui.md → Cards): its image, which opens it, and a
 * centered "001 · Pineco" caption that wraps rather than truncating. Owned
 * cards get an IonBadge with the copies owned in `language`.
 *
 * In a deck's Add cards (`adding`), tapping the image adds the card instead
 * (the host decides), the badge shows the copies in the deck rather than
 * those owned (same place and color), and an info button after the caption
 * opens the card.
 */
@Component({
  selector: 'app-card-tile',
  styles: [
    `
      .card-button {
        position: relative;
        display: block;
        width: 100%;
        padding: 0;
        border: 0;
        background: none;
        cursor: pointer;
      }
      .count {
        position: absolute;
        right: 6%;
        bottom: 6%;
      }
      /* The caption with the info button after it, centered together. */
      .caption-row {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .info {
        flex-shrink: 0;
        margin: 0;
        --padding-start: 4px;
        --padding-end: 4px;
      }
      .caption {
        margin: 4px 0 8px;
        font-size: 0.75rem;
        text-align: center;
        overflow-wrap: anywhere;
      }
    `,
  ],
  template: `
    <button class="card-button" type="button" (click)="opened.emit()" [attr.aria-label]="label()">
      <app-card-image [card]="card()" [language]="language()" [setLine]="setLine()" />
      @if (adding()) {
        @if (inDeck()) {
          <ion-badge class="count" color="danger" aria-hidden="true" data-testid="in-deck-badge">
            {{ inDeck() }}
          </ion-badge>
        }
      } @else if (owned()) {
        <ion-badge class="count" color="danger" aria-hidden="true" data-testid="owned-badge">
          {{ owned() }}
        </ion-badge>
      }
    </button>
    <div class="caption-row">
      <ion-text color="medium">
        <p class="caption">{{ card().localId }} · {{ name() }}</p>
      </ion-text>
      @if (adding()) {
        <ion-button
          class="info"
          fill="clear"
          size="small"
          (click)="info.emit()"
          [attr.aria-label]="'Show ' + name()"
          data-testid="tile-info"
        >
          <ion-icon slot="icon-only" name="information-circle-outline"></ion-icon>
        </ion-button>
      }
    </div>
  `,
  imports: [IonBadge, IonButton, IonIcon, IonText, CardImageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardTileComponent {
  private readonly collection = inject(CollectionService);

  readonly card = input.required<CatalogCard>();
  readonly language = input.required<CatalogLanguage>();
  /** The card's name in `language`. */
  readonly name = input.required<string>();
  /** Set and number, for the no-scan stand-in. */
  readonly setLine = input.required<string>();
  /** In a deck's Add cards: tapping adds the card, and the info button opens it. */
  readonly adding = input(false);
  /** Copies in the deck being built (`adding`), shown in the badge instead of those owned. */
  readonly inDeck = input(0);
  readonly opened = output();
  /** The info button (`adding`): open the card rather than add it. */
  readonly info = output();

  /** Copies owned in `language`, across variants. */
  readonly owned = computed(() =>
    this.collection.cardTotal(this.card().region, this.card().id, this.language())
  );
  readonly label = computed(() => {
    if (this.adding()) {
      return this.inDeck()
        ? `Add ${this.name()}, ${String(this.inDeck())} in deck`
        : `Add ${this.name()}`;
    }
    return this.owned() ? `${this.name()}, ${String(this.owned())} owned` : this.name();
  });

  constructor() {
    addIcons({ informationCircleOutline });
  }
}
