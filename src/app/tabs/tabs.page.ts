import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import {
  IonIcon,
  IonLabel,
  IonMenu,
  IonSplitPane,
  IonTabBar,
  IonTabButton,
  IonTabs,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { albums, layers, settings } from 'ionicons/icons';
import { filter, map } from 'rxjs';
import { LayoutService } from '../core/services/layout.service';
import { CardsMenuComponent } from '../features/cards/cards-menu.component';

/**
 * The tab bar, with stock Ionic tab stacks (each tab keeps its pages; tapping
 * the current tab pops to its root). From the `lg` breakpoint an IonSplitPane
 * shows the Cards sets list beside the tabs, only while the Cards tab is open:
 * Ionic hides a split pane's menu while it's disabled.
 */
@Component({
  selector: 'app-tabs',
  templateUrl: 'tabs.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonSplitPane,
    IonMenu,
    IonTabs,
    IonTabBar,
    IonTabButton,
    IonIcon,
    IonLabel,
    CardsMenuComponent,
  ],
})
export class TabsPage {
  private readonly router = inject(Router);
  private readonly layout = inject(LayoutService);

  private readonly onCardsTab = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => isCardsUrl(this.router.url))
    ),
    { initialValue: isCardsUrl(this.router.url) }
  );

  /** The Cards side pane shows on wide screens while the Cards tab is open. */
  readonly cardsMenu = computed(() => this.layout.wide() && this.onCardsTab());

  constructor() {
    addIcons({ albums, layers, settings });
  }
}

function isCardsUrl(url: string): boolean {
  return /^\/tabs\/cards(?:[/?#]|$)/.test(url);
}
