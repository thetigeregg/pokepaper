import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import {
  IonButtons,
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  NavController,
} from '@ionic/angular';
import type { CatalogSet } from '@pokepaper/shared';
import { filter, map } from 'rxjs';
import { catalogKey } from '../../core/data/storage-engine';
import { CatalogBrowseService } from '../../core/services/catalog-browse.service';
import { CatalogSearchService } from '../../core/services/catalog-search.service';
import { LayoutService } from '../../core/services/layout.service';
import { CardSearchbarComponent } from './card-searchbar.component';
import { CatalogSegmentComponent } from './catalog-segment.component';
import { LanguageButtonComponent } from './language-button.component';
import { SetsListComponent } from './sets-list.component';

const SET_URL = /^\/tabs\/cards\/set\/([^/]+)\/([^/?#]+)/;

/**
 * The Cards tab's desktop side pane (docs/ui.md → Cards): the language
 * button, the searchbar, the catalog segment and the sets list, inside the IonMenu that TabsPage's IonSplitPane shows
 * beside the tabs while the Cards tab is open on a wide screen.
 */
@Component({
  selector: 'app-cards-menu',
  host: { class: 'ion-page' },
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Cards</ion-title>
        <ion-buttons slot="end">
          <app-language-button
            [languages]="browse.languages()"
            [value]="browse.language()"
            (changed)="browse.pickLanguage($event)"
          />
        </ion-buttons>
      </ion-toolbar>
      <ion-toolbar>
        <app-card-searchbar />
      </ion-toolbar>
      <ion-toolbar>
        <app-catalog-segment />
      </ion-toolbar>
    </ion-header>
    <ion-content>
      @if (layout.wide()) {
        <app-sets-list [selectedKey]="selectedKey()" (selected)="open($event)" />
      }
    </ion-content>
  `,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonContent,
    CardSearchbarComponent,
    CatalogSegmentComponent,
    LanguageButtonComponent,
    SetsListComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardsMenuComponent {
  private readonly nav = inject(NavController);
  private readonly router = inject(Router);
  private readonly search = inject(CatalogSearchService);
  readonly browse = inject(CatalogBrowseService);
  readonly layout = inject(LayoutService);

  /** The set open beside the list, highlighted in it. */
  readonly selectedKey = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => setKeyFromUrl(this.router.url))
    ),
    { initialValue: setKeyFromUrl(this.router.url) }
  );

  open(set: CatalogSet): void {
    this.search.deactivate(); // The set replaces the search results (kept for the searchbar).
    // Beside the list, a set replaces the previous one instead of stacking.
    void this.nav.navigateRoot(['/tabs/cards/set', set.region, set.id], { animated: false });
  }
}

export function setKeyFromUrl(url: string): string | null {
  const match = SET_URL.exec(url);
  return match?.[1] && match[2]
    ? catalogKey(match[1] as CatalogSet['region'], decodeURIComponent(match[2]))
    : null;
}
