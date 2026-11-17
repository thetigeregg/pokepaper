import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonMenu,
  IonRouterOutlet,
  IonSplitPane,
  IonTitle,
  IonToolbar,
  NavController,
} from '@ionic/angular';
import type { CatalogSet } from '@pokepaper/shared';
import { filter, map } from 'rxjs';
import { catalogKey } from '../core/data/storage-engine';
import { LayoutService } from '../core/services/layout.service';
import { CatalogSegmentComponent } from '../features/cards/catalog-segment.component';
import { SetsListComponent } from '../features/cards/sets-list.component';

const SET_URL = /^\/tabs\/cards\/set\/([^/]+)\/([^/?#]+)/;

/**
 * Cards tab shell (docs/ui.md → Cards). From Ionic's `lg` breakpoint an
 * IonSplitPane keeps the catalog segment and sets list in an IonMenu beside
 * the selected set. On phones the menu is off and the home route shows the
 * sets list as a page that pushes the set page.
 */
@Component({
  selector: 'app-cards',
  templateUrl: 'cards.page.html',
  imports: [
    IonSplitPane,
    IonMenu,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonRouterOutlet,
    CatalogSegmentComponent,
    SetsListComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardsPage {
  private readonly nav = inject(NavController);
  private readonly router = inject(Router);
  readonly layout = inject(LayoutService);

  /** The set open in the main pane, highlighted in the list. */
  readonly selectedKey = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => keyFromUrl(this.router.url))
    ),
    { initialValue: keyFromUrl(this.router.url) }
  );

  open(set: CatalogSet): void {
    // Beside the list, a set replaces the previous one instead of stacking.
    void this.nav.navigateRoot(['/tabs/cards/set', set.region, set.id], { animated: false });
  }
}

function keyFromUrl(url: string): string | null {
  const match = SET_URL.exec(url);
  return match?.[1] && match[2]
    ? catalogKey(match[1] as CatalogSet['region'], decodeURIComponent(match[2]))
    : null;
}
