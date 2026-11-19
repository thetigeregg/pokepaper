import { ChangeDetectionStrategy, Component, ElementRef, inject } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonSearchbar,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular';
import { MAX_DECK_CARD_COUNT, deckCardKey, type CatalogCard } from '@pokepaper/shared';
import { catalogKey } from '../../core/data/storage-engine';
import { CatalogSearchService } from '../../core/services/catalog-search.service';
import { DeckService } from '../../core/services/deck.service';
import { LayoutService } from '../../core/services/layout.service';
import { CatalogSegmentComponent } from '../../features/cards/catalog-segment.component';
import { FiltersButtonComponent } from '../../features/cards/filters-button.component';
import { SearchFiltersComponent } from '../../features/cards/search-filters.component';
import {
  SearchResultsComponent,
  type CardPicker,
} from '../../features/cards/search-results.component';
import { DeckDialogsService } from '../../features/decks/deck-dialogs.service';

/**
 * A deck's Add cards modal (docs/ui.md → Decks): card search with its own
 * query and filters (its own `CatalogSearchService`; recent searches and the
 * catalog are shared with the Cards tab). Tapping a card adds a copy to the
 * deck; its badge shows the copies in the deck, and its info button opens it.
 */
@Component({
  selector: 'app-add-cards',
  providers: [CatalogSearchService],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Add cards</ion-title>
        <ion-buttons slot="end">
          @if (!layout.wide()) {
            <app-filters-button />
          }
          <ion-button [strong]="true" (click)="done()" data-testid="add-cards-done">
            Done
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar
          #bar
          placeholder="Search cards"
          [value]="search.query()"
          [debounce]="150"
          (ionInput)="search.setQuery($event.detail.value ?? '')"
          (keyup.enter)="submit(bar)"
          data-testid="add-cards-searchbar"
        ></ion-searchbar>
      </ion-toolbar>
      <ion-toolbar>
        <app-catalog-segment />
      </ion-toolbar>
      @if (layout.wide()) {
        <ion-toolbar>
          <app-search-filters />
        </ion-toolbar>
      }
    </ion-header>
    <ion-content>
      <app-search-results [picker]="picker" />
    </ion-content>
  `,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonSearchbar,
    IonContent,
    CatalogSegmentComponent,
    FiltersButtonComponent,
    SearchFiltersComponent,
    SearchResultsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddCardsComponent {
  readonly search = inject(CatalogSearchService);
  readonly layout = inject(LayoutService);
  private readonly decks = inject(DeckService);
  private readonly dialogs = inject(DeckDialogsService);
  private readonly modals = inject(ModalController);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  // Set through ModalController componentProps, which assigns plain
  // properties (docs/ui.md → Tests).
  deckIdProp = '';

  readonly picker: CardPicker = {
    count: (card) => this.count(card),
    pick: (card) => void this.add(card),
  };

  /** Copies of `card` in the deck. */
  count(card: CatalogCard): number {
    const key = catalogKey(card.region, card.id);
    return (
      this.decks.deck(this.deckIdProp)?.cards.find((slot) => deckCardKey(slot) === key)?.count ?? 0
    );
  }

  /** Adds a copy of `card` (none past `MAX_DECK_CARD_COUNT`). */
  async add(card: CatalogCard): Promise<void> {
    const count = this.count(card);
    if (count >= MAX_DECK_CARD_COUNT) {
      return;
    }
    try {
      await this.decks.setCardCount(
        this.deckIdProp,
        { region: card.region, cardId: card.id },
        count + 1
      );
    } catch (error: unknown) {
      await this.dialogs.showSaveError(error);
    }
  }

  /** Enter: search for what's typed now, remember it, and put the phone keyboard away. */
  async submit(bar: IonSearchbar): Promise<void> {
    const input = await bar.getInputElement();
    this.search.setQuery(input.value);
    void this.search.rememberQuery();
    if (!this.layout.wide()) {
      input.blur();
    }
  }

  /**
   * Closes this modal: its own, not just the top one (a filter sheet may
   * still be closing on top of it).
   */
  done(): void {
    const modal = this.host.nativeElement.closest('ion-modal');
    void (modal ? modal.dismiss() : this.modals.dismiss());
  }
}
