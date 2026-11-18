import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IonText } from '@ionic/angular';
import type { CatalogCard, CatalogLanguage } from '@pokepaper/shared';
import { CardImageComponent } from './card-image.component';

/**
 * A card in a grid (docs/ui.md → Cards): its image, which opens it, and a
 * centered "001 · Pineco" caption that wraps rather than truncating.
 */
@Component({
  selector: 'app-card-tile',
  styles: [
    `
      .card-button {
        display: block;
        width: 100%;
        padding: 0;
        border: 0;
        background: none;
        cursor: pointer;
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
    <button class="card-button" type="button" (click)="opened.emit()" [attr.aria-label]="name()">
      <app-card-image [card]="card()" [language]="language()" [setLine]="setLine()" />
    </button>
    <ion-text color="medium">
      <p class="caption">{{ card().localId }} · {{ name() }}</p>
    </ion-text>
  `,
  imports: [IonText, CardImageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardTileComponent {
  readonly card = input.required<CatalogCard>();
  readonly language = input.required<CatalogLanguage>();
  /** The card's name in `language`. */
  readonly name = input.required<string>();
  /** Set and number, for the no-scan stand-in. */
  readonly setLine = input.required<string>();
  readonly opened = output();
}
