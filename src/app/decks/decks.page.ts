import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
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
  NavController,
} from '@ionic/angular';
import type { Deck } from '@pokepaper/shared';
import { addIcons } from 'ionicons';
import { addOutline } from 'ionicons/icons';
import { DeckService } from '../core/services/deck.service';
import { DeckDialogsService } from '../features/decks/deck-dialogs.service';
import { deckSummary } from '../features/decks/deck-display';

/**
 * The Decks tab (docs/ui.md → Decks): every deck, most recently changed
 * first, each opening its deck page. The header's add button names a new
 * Standard deck and opens it.
 */
@Component({
  selector: 'app-decks',
  templateUrl: 'decks.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
  ],
})
export class DecksPage {
  readonly decks = inject(DeckService);
  private readonly dialogs = inject(DeckDialogsService);
  private readonly nav = inject(NavController);

  /** A new deck is being named or saved. */
  readonly busy = signal(false);

  constructor() {
    addIcons({ addOutline });
  }

  summary(deck: Deck): string {
    return deckSummary(deck);
  }

  open(id: string): void {
    void this.nav.navigateForward(['/tabs/decks/deck', id]);
  }

  /** Names a new Standard deck, saves it and opens it. */
  async create(): Promise<void> {
    this.busy.set(true);
    try {
      const name = await this.dialogs.askNewName();
      if (name === null) {
        return;
      }
      const deck = await this.decks.create(name, 'standard');
      this.open(deck.id);
    } catch {
      await this.dialogs.showSaveError();
    } finally {
      this.busy.set(false);
    }
  }
}
