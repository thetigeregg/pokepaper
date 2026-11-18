import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  IonContent,
  IonHeader,
  IonIcon,
  IonText,
  IonTitle,
  IonToolbar,
  NavController,
} from '@ionic/angular';
import type { CatalogSet } from '@pokepaper/shared';
import { LayoutService } from '../../core/services/layout.service';
import { CatalogSegmentComponent } from '../../features/cards/catalog-segment.component';
import { SetsListComponent } from '../../features/cards/sets-list.component';
import { addIcons } from 'ionicons';
import { albumsOutline } from 'ionicons/icons';

/**
 * Cards home. On phones: the catalog segment and sets list, pushing the set
 * page. On desktop (the list is in the side menu): a prompt to pick a set.
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
    IonTitle,
    IonContent,
    IonIcon,
    IonText,
    CatalogSegmentComponent,
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

  open(set: CatalogSet): void {
    void this.nav.navigateForward(['/tabs/cards/set', set.region, set.id]);
  }
}
