import { Routes } from '@angular/router';
import { TabsPage } from './tabs.page';

export const routes: Routes = [
  {
    path: 'tabs',
    component: TabsPage,
    children: [
      {
        path: 'cards',
        loadComponent: () => import('../cards/home/cards-home.page').then((m) => m.CardsHomePage),
      },
      {
        path: 'cards/set/:region/:setId',
        loadComponent: () => import('../cards/set/set.page').then((m) => m.SetPage),
      },
      {
        // Collection tracking moved into the Cards tab (docs/collection.md);
        // kept so old links and bookmarks still land somewhere.
        path: 'collection',
        redirectTo: '/tabs/cards',
        pathMatch: 'full',
      },
      {
        path: 'decks',
        loadComponent: () => import('../decks/decks.page').then((m) => m.DecksPage),
      },
      {
        path: 'decks/deck/:id',
        loadComponent: () => import('../decks/deck/deck.page').then((m) => m.DeckPage),
      },
      {
        path: 'settings',
        loadComponent: () => import('../settings/settings.page').then((m) => m.SettingsPage),
      },
      {
        path: 'settings/downloads',
        loadComponent: () =>
          import('../settings/downloads/downloads.page').then((m) => m.DownloadsPage),
      },
      {
        path: '',
        redirectTo: '/tabs/cards',
        pathMatch: 'full',
      },
    ],
  },
  {
    path: '',
    redirectTo: '/tabs/cards',
    pathMatch: 'full',
  },
];
