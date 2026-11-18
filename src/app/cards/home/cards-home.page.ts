import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonText,
  IonTitle,
  IonToolbar,
  NavController,
} from '@ionic/angular';
import type { CatalogSet } from '@pokepaper/shared';
import { CatalogSearchService } from '../../core/services/catalog-search.service';
import { LayoutService } from '../../core/services/layout.service';
import { CardSearchbarComponent } from '../../features/cards/card-searchbar.component';
import { CatalogSegmentComponent } from '../../features/cards/catalog-segment.component';
import { FiltersButtonComponent } from '../../features/cards/filters-button.component';
import { SearchFiltersComponent } from '../../features/cards/search-filters.component';
import { SearchResultsComponent } from '../../features/cards/search-results.component';
import { SetsListComponent } from '../../features/cards/sets-list.component';
import { addIcons } from 'ionicons';
import { albumsOutline } from 'ionicons/icons';

/**
 * Cards home. On phones: the Filters button, the searchbar, the catalog
 * segment and the sets list, pushing the set page, with search results in
 * place of the list while searching. On desktop (the searchbar and list are in the side menu): the
 * search results while searching, else a prompt to pick a set.
 */
@Component({
  selector: 'app-cards-home',
  templateUrl: 'cards-home.page.html',
  styles: [
    `
      .pick-set {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
      }
      .pick-set ion-icon {
        font-size: 3rem;
      }
    `,
  ],
  imports: [
    IonHeader,
    IonToolbar,
    IonButtons,
    IonTitle,
    IonContent,
    IonIcon,
    IonText,
    CatalogSegmentComponent,
    CardSearchbarComponent,
    FiltersButtonComponent,
    SearchFiltersComponent,
    SearchResultsComponent,
    SetsListComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardsHomePage {
  constructor() {
    addIcons({ albumsOutline });
  }

  private readonly nav = inject(NavController);
  readonly layout = inject(LayoutService);
  readonly search = inject(CatalogSearchService);

  open(set: CatalogSet): void {
    void this.nav.navigateForward(['/tabs/cards/set', set.region, set.id]);
  }
}
