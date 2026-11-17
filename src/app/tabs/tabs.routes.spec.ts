import { routes } from './tabs.routes';
import { routes as appRoutes } from '../app.routes';

describe('tab routes', () => {
  const tabs = routes.find((route) => route.path === 'tabs');

  it('lazy-loads each tab page', async () => {
    const children = tabs?.children ?? [];
    const loaded: unknown[] = [];
    for (const child of children) {
      if (child.loadComponent) {
        loaded.push(await child.loadComponent());
      }
    }

    expect(children.map((child) => child.path)).toEqual([
      'cards',
      'collection',
      'decks',
      'settings',
      '',
    ]);
    expect(loaded.every(Boolean)).toBe(true);
  });

  it('redirects the root to the Cards tab', () => {
    expect(routes.find((route) => route.path === '')?.redirectTo).toBe('/tabs/cards');
  });

  it('app routes guard and lazy-load the tab routes, and offer a guarded login route', async () => {
    const app = appRoutes.find((route) => route.path === '');
    const login = appRoutes.find((route) => route.path === 'login');

    expect(await app?.loadChildren?.()).toBe(routes);
    expect(app?.canActivate).toHaveLength(1);
    expect(login?.canActivate).toHaveLength(1);
    expect(await login?.loadComponent?.()).toBeDefined();
    expect(appRoutes.at(-1)).toMatchObject({ path: '**', redirectTo: '' });
  });
});
