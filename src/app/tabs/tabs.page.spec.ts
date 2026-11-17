import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { NavController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { makeContractPack } from '../core/data/storage-engine.contract';
import { LayoutService } from '../core/services/layout.service';
import { CardsHomePage } from '../cards/home/cards-home.page';
import { CardsMenuComponent, setKeyFromUrl } from '../features/cards/cards-menu.component';
import { TabsPage } from './tabs.page';

describe('tabs and the Cards side pane', () => {
  const events = new Subject<unknown>();
  const router = { url: '/tabs/cards/set/intl/sv01', events: events.asObservable() };
  const nav = { navigateRoot: vi.fn(), navigateForward: vi.fn() };
  const wide = signal(true);
  const set = makeContractPack('asia', 'SV2a', []).set;

  function navigate(url: string): void {
    router.url = url;
    events.next(new NavigationEnd(1, url, url));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    wide.set(true);
    router.url = '/tabs/cards/set/intl/sv01';
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: router },
        { provide: NavController, useValue: nav },
        { provide: LayoutService, useValue: { wide } },
      ],
    });
  });

  async function create<T>(component: new (...args: never[]) => T): Promise<T> {
    TestBed.overrideComponent(component, { set: { template: '', imports: [] } });
    await TestBed.compileComponents();
    return TestBed.createComponent(component).componentInstance;
  }

  it('shows the side pane only on wide screens with the Cards tab open', async () => {
    const tabs = await create(TabsPage);
    expect(tabs.cardsMenu()).toBe(true);

    navigate('/tabs/settings/downloads');
    expect(tabs.cardsMenu()).toBe(false);

    navigate('/tabs/cards');
    expect(tabs.cardsMenu()).toBe(true);
    navigate('/tabs/cardsharks');
    expect(tabs.cardsMenu()).toBe(false);

    navigate('/tabs/cards');
    wide.set(false);
    expect(tabs.cardsMenu()).toBe(false);
  });

  it('highlights the set in the URL and follows navigation', async () => {
    const menu = await create(CardsMenuComponent);
    expect(menu.selectedKey()).toBe('intl:sv01');

    navigate('/tabs/cards');
    expect(menu.selectedKey()).toBeNull();
    expect(setKeyFromUrl('/tabs/cards/set/asia/SV%202a?x=1')).toBe('asia:SV 2a');
  });

  it('replaces the set beside the list on desktop', async () => {
    const menu = await create(CardsMenuComponent);

    menu.open(set);

    expect(nav.navigateRoot).toHaveBeenCalledWith(['/tabs/cards/set', 'asia', 'SV2a'], {
      animated: false,
    });
  });

  it('pushes the set page from the phone list', async () => {
    const home = await create(CardsHomePage);

    home.open(set);

    expect(nav.navigateForward).toHaveBeenCalledWith(['/tabs/cards/set', 'asia', 'SV2a']);
  });
});
