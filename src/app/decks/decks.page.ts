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
import { addOutline, warningOutline } from 'ionicons/icons';
import { DeckChecksService } from '../features/decks/deck-checks.service';
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
  private readonly checks = inject(DeckChecksService);
  private readonly nav = inject(NavController);

  /** A new deck is being named or saved. */
  readonly busy = signal(false);

  constructor() {
    addIcons({ addOutline, warningOutline });
  }

  /** "Standard · 47 cards", plus "· 3 issues" once checked and it breaks its rules. */
  summary(deck: Deck): string {
    const count = this.issues(deck);
    return count === 0
      ? deckSummary(deck)
      : `${deckSummary(deck)} · ${String(count)} ${count === 1 ? 'issue' : 'issues'}`;
  }

  /** Rules the deck breaks (0 until it has been checked). */
  issues(deck: Deck): number {
    return this.checks.check(deck.id)?.issues.length ?? 0;
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
