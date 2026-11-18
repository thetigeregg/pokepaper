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
        path: 'collection',
        loadComponent: () => import('../collection/collection.page').then((m) => m.CollectionPage),
      },
      {
        path: 'decks',
        loadComponent: () => import('../decks/decks.page').then((m) => m.DecksPage),
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
