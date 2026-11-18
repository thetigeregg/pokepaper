import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { IonBadge, IonText } from '@ionic/angular';
import type { CatalogCard, CatalogLanguage } from '@pokepaper/shared';
import { CollectionService } from '../../core/services/collection.service';
import { CardImageComponent } from './card-image.component';

/**
 * A card in a grid (docs/ui.md → Cards): its image, which opens it, and a
 * centered "001 · Pineco" caption that wraps rather than truncating. Owned
 * cards get an IonBadge with the copies owned in `language`.
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
      .owned {
        position: absolute;
        right: 6%;
        bottom: 6%;
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
      @if (owned()) {
        <ion-badge class="owned" color="danger" aria-hidden="true" data-testid="owned-badge">
          {{ owned() }}
        </ion-badge>
      }
    </button>
    <ion-text color="medium">
      <p class="caption">{{ card().localId }} · {{ name() }}</p>
    </ion-text>
  `,
  imports: [IonBadge, IonText, CardImageComponent],
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
  readonly opened = output();

  /** Copies owned in `language`, across variants. */
  readonly owned = computed(() =>
    this.collection.cardTotal(this.card().region, this.card().id, this.language())
  );
  readonly label = computed(() =>
    this.owned() ? `${this.name()}, ${String(this.owned())} owned` : this.name()
  );
}
