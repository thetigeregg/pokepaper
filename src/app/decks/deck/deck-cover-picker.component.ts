import { ChangeDetectionStrategy, Component, ElementRef, inject } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { checkmarkOutline } from 'ionicons/icons';
import { CardImageComponent } from '../../features/cards/card-image.component';
import type { DeckRow } from './deck.page';

/** What the picker resolves with: the chosen printing's key, or null for the default. */
export interface DeckCoverChoice {
  key: string | null;
}

/**
 * The deck page's "Choose cover" sheet (docs/ui.md → Decks): the default
 * (the first Pokémon), then the deck's cards with their scans; the current
 * choice is checked. Picking one closes the sheet with it (`DeckCoverChoice`
 * as the dismiss data, role `select`).
 */
@Component({
  selector: 'app-deck-cover-picker',
  styles: [
    `
      .thumb {
        flex-shrink: 0;
        width: 40px;
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="close()" data-testid="cover-cancel">Cancel</ion-button>
        </ion-buttons>
        <ion-title>Choose cover</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <ion-list>
        <ion-item
          button="true"
          [detail]="false"
          lines="inset"
          (click)="pick(null)"
          data-testid="cover-default"
        >
          <ion-label>
            First Pokémon
            <p class="hint">The default</p>
          </ion-label>
          @if (currentProp === null) {
            <ion-icon
              slot="end"
              name="checkmark-outline"
              color="primary"
              aria-label="Chosen"
            ></ion-icon>
          }
        </ion-item>
        @for (row of rowsProp; track row.key) {
          @if (row.card; as card) {
            <ion-item
              button="true"
              [detail]="false"
              lines="inset"
              (click)="pick(row.key)"
              [attr.data-testid]="'cover-' + row.key"
            >
              <ion-label>
                <div class="media-row">
                  <div class="thumb">
                    <app-card-image [card]="card" [language]="row.language" [setLine]="row.line" />
                  </div>
                  <div class="media-row-text">
                    {{ row.name }}
                    <p class="hint">{{ row.line }}</p>
                  </div>
                </div>
              </ion-label>
              @if (currentProp === row.key) {
                <ion-icon
                  slot="end"
                  name="checkmark-outline"
                  color="primary"
                  aria-label="Chosen"
                ></ion-icon>
              }
            </ion-item>
          }
        }
      </ion-list>
    </ion-content>
  `,
  imports: [
    IonHeader,
    IonToolbar,
    IonButtons,
    IonButton,
    IonTitle,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonIcon,
    CardImageComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckCoverPickerComponent {
  private readonly modals = inject(ModalController);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  // Set through ModalController componentProps, which assigns plain
  // properties (docs/ui.md → Tests).
  /** The deck's cards, in the deck page's order. */
  rowsProp: readonly DeckRow[] = [];
  /** The chosen cover's key, or null for the default. */
  currentProp: string | null = null;

  constructor() {
    addIcons({ checkmarkOutline });
  }

  pick(key: string | null): void {
    const choice: DeckCoverChoice = { key };
    void this.dismiss(choice, 'select');
  }

  close(): void {
    void this.dismiss(undefined, 'cancel');
  }

  /** Closes this modal: its own, not just the top one. */
  private dismiss(data: DeckCoverChoice | undefined, role: string): Promise<boolean> {
    const modal = this.host.nativeElement.closest('ion-modal');
    return modal ? modal.dismiss(data, role) : this.modals.dismiss(data, role);
  }
}
