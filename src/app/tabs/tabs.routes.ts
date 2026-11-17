import { Routes } from '@angular/router';
import { TabsPage } from './tabs.page';

export const routes: Routes = [
  {
    path: 'tabs',
    component: TabsPage,
    children: [
      {
        path: 'cards',
        loadComponent: () => import('../cards/cards.page').then((m) => m.CardsPage),
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
