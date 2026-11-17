import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { NavController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { makeContractPack } from '../core/data/storage-engine.contract';
import { LayoutService } from '../core/services/layout.service';
import { CardsPage } from './cards.page';
import { CardsHomePage } from './home/cards-home.page';

describe('Cards tab', () => {
  const events = new Subject<unknown>();
  const router = { url: '/tabs/cards/set/intl/sv01', events: events.asObservable() };
  const nav = { navigateRoot: vi.fn(), navigateForward: vi.fn() };
  const set = makeContractPack('asia', 'SV2a', []).set;

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: router },
        { provide: NavController, useValue: nav },
        { provide: LayoutService, useValue: { wide: signal(true) } },
      ],
    });
  });

  async function create<T>(component: new (...args: never[]) => T): Promise<T> {
    TestBed.overrideComponent(component, { set: { template: '', imports: [] } });
    await TestBed.compileComponents();
    return TestBed.createComponent(component).componentInstance;
  }

  it('highlights the set in the URL and follows navigation', async () => {
    const page = await create(CardsPage);
    expect(page.selectedKey()).toBe('intl:sv01');

    router.url = '/tabs/cards';
    events.next(new NavigationEnd(1, '/tabs/cards', '/tabs/cards'));
    expect(page.selectedKey()).toBeNull();
    router.url = '/tabs/cards/set/intl/sv01';
  });

  it('replaces the set beside the list on desktop', async () => {
    const page = await create(CardsPage);

    page.open(set);

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
