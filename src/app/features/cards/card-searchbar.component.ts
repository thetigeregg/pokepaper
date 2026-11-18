import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonSearchbar, NavController } from '@ionic/angular';
import { CatalogSearchService } from '../../core/services/catalog-search.service';
import { LayoutService } from '../../core/services/layout.service';

/** The Cards tab's root URL, where search results show. */
export const CARDS_HOME_URL = '/tabs/cards';

/**
 * The Cards tab's IonSearchbar (docs/ui.md → Cards → Search), under the
 * title on phones and in the side menu on desktop. Focusing it shows search
 * in place of the sets list (phone) or the open set (desktop). On phones,
 * Cancel clears the query and filters and brings the sets list back.
 */
@Component({
  selector: 'app-card-searchbar',
  template: `
    <ion-searchbar
      #bar
      placeholder="Search cards"
      [value]="search.query()"
      [debounce]="150"
      [showCancelButton]="!layout.wide() && search.active() ? 'always' : 'never'"
      (ionInput)="input($event.detail.value ?? '')"
      (ionFocus)="focus()"
      (ionCancel)="search.exit()"
      (keyup.enter)="submit(bar)"
      data-testid="card-searchbar"
    ></ion-searchbar>
  `,
  imports: [IonSearchbar],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardSearchbarComponent {
  readonly search = inject(CatalogSearchService);
  readonly layout = inject(LayoutService);
  private readonly router = inject(Router);
  private readonly nav = inject(NavController);

  focus(): void {
    this.search.activate();
    this.showResults();
  }

  input(query: string): void {
    this.search.setQuery(query);
    this.showResults();
  }

  /** On desktop, results replace whichever set is open beside the menu. */
  private showResults(): void {
    if (this.layout.wide() && this.router.url.split(/[?#]/)[0] !== CARDS_HOME_URL) {
      void this.nav.navigateRoot(CARDS_HOME_URL, { animated: false });
    }
  }

  /**
   * Enter: search for what's typed now (the debounced input may not have
   * caught up), remember it, and put the phone keyboard away.
   */
  async submit(bar: IonSearchbar): Promise<void> {
    const input = await bar.getInputElement();
    this.input(input.value);
    void this.search.rememberQuery();
    if (!this.layout.wide()) {
      input.blur();
    }
  }
}
