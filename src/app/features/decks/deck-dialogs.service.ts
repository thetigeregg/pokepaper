import { Injectable, inject } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular';
import {
  MAX_DECK_CARD_COUNT,
  MAX_DECK_NAME_LENGTH,
  isDeckName,
  type Deck,
} from '@pokepaper/shared';
import { DeckChangeDroppedError, DeckFullError } from '../../core/services/deck.service';

/**
 * The deck screens' dialogs (docs/ui.md → Decks): stock Ionic alerts for
 * naming and deleting a deck, and a toast when a change can't be saved.
 */
@Injectable({ providedIn: 'root' })
export class DeckDialogsService {
  private readonly alerts = inject(AlertController);
  private readonly toasts = inject(ToastController);

  /** Asks for a new deck's name: the trimmed name, or null if canceled. */
  askNewName(): Promise<string | null> {
    return this.askName('New deck', 'Create', '');
  }

  /** Asks for a deck's new name: the trimmed name, or null if canceled or unchanged. */
  async askRename(deck: Deck): Promise<string | null> {
    const name = await this.askName('Rename deck', 'Rename', deck.name);
    return name === deck.name ? null : name;
  }

  /** Whether the user confirms deleting `deck`. */
  async confirmDelete(deck: Deck): Promise<boolean> {
    const alert = await this.alerts.create({
      header: `Delete "${deck.name}"?`,
      message: 'This deck is removed from all your devices.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Delete', role: 'confirm', cssClass: 'alert-button-danger' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    return role === 'confirm';
  }

  /**
   * Says a deck change didn't happen: the deck is full, or it couldn't be
   * saved (and has been rolled back). Changes dropped behind a failed save
   * say nothing: that failure is reported once.
   */
  async showSaveError(error?: unknown): Promise<void> {
    if (error instanceof DeckChangeDroppedError) {
      return;
    }
    await this.showToast(
      error instanceof DeckFullError ? `${error.message}.` : "Couldn't save the deck. Try again."
    );
  }

  /** Says a printing already has as many copies as a deck holds. */
  showCopyLimit(): Promise<void> {
    return this.showToast(
      `A deck holds at most ${String(MAX_DECK_CARD_COUNT)} copies of a printing.`
    );
  }

  private async showToast(message: string): Promise<void> {
    const toast = await this.toasts.create({
      message,
      color: 'danger',
      duration: 3000,
      position: 'bottom',
    });
    await toast.present();
  }

  private async askName(header: string, confirm: string, value: string): Promise<string | null> {
    const alert = await this.alerts.create({
      header,
      inputs: [
        {
          name: 'name',
          type: 'text',
          value,
          placeholder: 'Deck name',
          attributes: { maxlength: MAX_DECK_NAME_LENGTH, autocapitalize: 'words' },
        },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: confirm,
          role: 'confirm',
          // A blank name keeps the alert open.
          handler: (data: { name?: string }) => isDeckName(data.name ?? ''),
        },
      ],
    });
    await alert.present();
    // Ready to type (and the phone keyboard up) without tapping the field first.
    alert.querySelector('input')?.focus();
    const { role, data } = await alert.onDidDismiss<{ values?: { name?: string } }>();
    const name = data?.values?.name?.trim() ?? '';
    return role === 'confirm' && isDeckName(name) ? name : null;
  }
}
