import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ModalController, NavController, PopoverController } from '@ionic/angular';
import { vi } from 'vitest';
import { makeContractPack } from '../../core/data/storage-engine.contract';
import {
  CatalogSearchService,
  NO_FILTERS,
  type SearchFilters,
} from '../../core/services/catalog-search.service';
import { LayoutService } from '../../core/services/layout.service';
import { CardSearchbarComponent } from './card-searchbar.component';
import { FilterPickerComponent } from './filter-picker.component';
import { SearchFiltersComponent } from './search-filters.component';

describe('card searchbar and filter chips', () => {
  const filters = signal<SearchFilters>(NO_FILTERS);
  const sv01 = { ...makeContractPack('intl', 'sv01', []).set, names: { en: 'Scarlet & Violet' } };
  const search = {
    query: signal(''),
    active: signal(false),
    filters,
    language: signal('en'),
    sets: signal(new Map([['intl:sv01', { set: sv01, seriesKey: 'intl:sv', order: 0 }]])),
    seriesNames: signal(new Map([['intl:swsh', 'Sword & Shield']])),
    setQuery: vi.fn(),
    setFilters: vi.fn((next: SearchFilters) => {
      filters.set(next);
    }),
    activate: vi.fn(),
    exit: vi.fn(),
    rememberQuery: vi.fn(() => Promise.resolve()),
  };
  const wide = signal(false);
  const router = { url: '/tabs/cards/set/intl/sv01' };
  const nav = { navigateRoot: vi.fn() };
  const present = vi.fn(() => Promise.resolve());
  const modals = { create: vi.fn(() => Promise.resolve({ present })) };
  const popovers = { create: vi.fn(() => Promise.resolve({ present })) };

  beforeEach(() => {
    vi.clearAllMocks();
    filters.set(NO_FILTERS);
    wide.set(false);
    router.url = '/tabs/cards/set/intl/sv01';
    TestBed.configureTestingModule({
      providers: [
        { provide: CatalogSearchService, useValue: search },
        { provide: LayoutService, useValue: { wide } },
        { provide: Router, useValue: router },
        { provide: NavController, useValue: nav },
        { provide: ModalController, useValue: modals },
        { provide: PopoverController, useValue: popovers },
      ],
    });
  });

  describe('CardSearchbarComponent', () => {
    let fixture: ComponentFixture<CardSearchbarComponent>;

    function create(): CardSearchbarComponent {
      fixture = TestBed.createComponent(CardSearchbarComponent);
      fixture.detectChanges();
      return fixture.componentInstance;
    }

    it('shows search on focus and typing, staying on the page on phones', () => {
      const bar = create();

      bar.focus();
      bar.input('pika');

      expect(search.activate).toHaveBeenCalled();
      expect(search.setQuery).toHaveBeenCalledWith('pika');
      expect(nav.navigateRoot).not.toHaveBeenCalled();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('[data-testid="card-searchbar"]')).not.toBeNull();
    });

    it('replaces the open set with the results on desktop', () => {
      wide.set(true);
      const bar = create();

      bar.focus();
      expect(nav.navigateRoot).toHaveBeenCalledWith('/tabs/cards', { animated: false });

      nav.navigateRoot.mockClear();
      router.url = '/tabs/cards?from=menu';
      bar.input('pika');
      expect(nav.navigateRoot).not.toHaveBeenCalled();
    });

    it('remembers the search on Enter, putting the phone keyboard away', async () => {
      const bar = create();
      const blur = vi.fn();
      const element = { getInputElement: () => Promise.resolve({ blur, value: 'pikach' }) };

      await bar.submit(element as never);
      // Searches what's typed, even before the debounced input arrives.
      expect(search.setQuery).toHaveBeenCalledWith('pikach');
      expect(search.setQuery.mock.invocationCallOrder[0]).toBeLessThan(
        search.rememberQuery.mock.invocationCallOrder[0] ?? 0
      );
      expect(blur).toHaveBeenCalled();

      wide.set(true);
      blur.mockClear();
      await bar.submit(element as never);
      expect(blur).not.toHaveBeenCalled();
    });
  });

  describe('SearchFiltersComponent', () => {
    let fixture: ComponentFixture<SearchFiltersComponent>;

    function create(): SearchFiltersComponent {
      fixture = TestBed.createComponent(SearchFiltersComponent);
      fixture.detectChanges();
      return fixture.componentInstance;
    }

    const root = () => fixture.nativeElement as HTMLElement;

    it('labels each chip with its filter and values', () => {
      filters.set({
        ...NO_FILTERS,
        categories: ['Trainer/Supporter'],
        sets: ['intl:sv01'],
        series: ['intl:swsh', 'intl:gone'],
      });
      const chips = create();

      expect(chips.chips().map((chip) => [chip.kind, chip.active, chip.label])).toEqual([
        ['category', true, 'Category: Supporter'],
        ['type', false, 'Type'],
        ['rarity', false, 'Rarity'],
        ['set', true, 'Set: Sword & Shield +2'],
      ]);
      filters.set({ ...NO_FILTERS, series: ['intl:gone'], sets: ['intl:sv01'] });
      expect(chips.chips()[3]?.label).toBe('Set: intl:gone +1');
      filters.set({ ...NO_FILTERS, sets: ['intl:sv01'] });
      expect(chips.chips()[3]?.label).toBe('Set: Scarlet & Violet');
    });

    it('clears one filter or all of them', () => {
      filters.set({ ...NO_FILTERS, types: ['Fire'], rarities: ['Common'] });
      create();
      expect(root().querySelector('[data-testid="filter-clear-all"]')).not.toBeNull();

      (root().querySelector('[data-testid="filter-clear-type"]') as HTMLElement).click();
      expect(filters()).toEqual({ ...NO_FILTERS, rarities: ['Common'] });
      expect(modals.create).not.toHaveBeenCalled(); // The ✕ doesn't open the chip.

      fixture.detectChanges();
      (root().querySelector('[data-testid="filter-clear-all"]') as HTMLElement).click();
      expect(filters()).toEqual(NO_FILTERS);
      fixture.detectChanges();
      expect(root().querySelector('[data-testid="filter-clear-all"]')).toBeNull();
    });

    it('opens a filter in a sheet on phones', async () => {
      const chips = create();

      await chips.open('set', new Event('click'));
      await chips.open('type', new Event('click'));

      expect(modals.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          component: FilterPickerComponent,
          componentProps: { kindProp: 'set', sheetProp: true },
          initialBreakpoint: 1,
        })
      );
      expect(modals.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ initialBreakpoint: 0.5 })
      );
      expect(present).toHaveBeenCalledTimes(2);
    });

    it('opens a filter in a popover under its chip on desktop', async () => {
      wide.set(true);
      create();

      (root().querySelector('[data-testid="filter-chip-rarity"]') as HTMLElement).click();
      await vi.waitFor(() => {
        expect(present).toHaveBeenCalled();
      });

      expect(popovers.create).toHaveBeenCalledWith(
        expect.objectContaining({
          component: FilterPickerComponent,
          componentProps: { kindProp: 'rarity', sheetProp: false },
          cssClass: 'filter-popover',
        })
      );
    });
  });
});
