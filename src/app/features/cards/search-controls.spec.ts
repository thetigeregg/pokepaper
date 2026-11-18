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
import { FiltersButtonComponent } from './filters-button.component';
import { FiltersSheetComponent } from './filters-sheet.component';
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
    setNames: () => ({
      sets: search.sets(),
      seriesNames: search.seriesNames(),
      language: search.language(),
    }),
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
        owned: ['missing'],
      });
      const chips = create();

      expect(chips.chips().map((chip) => [chip.kind, chip.active, chip.label])).toEqual([
        ['collection', true, 'Collection: Missing'],
        ['category', true, 'Category: Supporter'],
        ['type', false, 'Type'],
        ['rarity', false, 'Rarity'],
        ['set', true, 'Set: Sword & Shield +2'],
      ]);
      filters.set({ ...NO_FILTERS, series: ['intl:gone'], sets: ['intl:sv01'] });
      expect(chips.chips()[4]?.label).toBe('Set: intl:gone +1');
      filters.set({ ...NO_FILTERS, sets: ['intl:sv01'] });
      expect(chips.chips()[4]?.label).toBe('Set: Scarlet & Violet');
    });

    it('clears one filter or all of them', () => {
      filters.set({ ...NO_FILTERS, types: ['Fire'], rarities: ['Common'] });
      create();
      expect(root().querySelector('[data-testid="filter-clear-all"]')).not.toBeNull();

      (root().querySelector('[data-testid="filter-clear-type"]') as HTMLElement).click();
      expect(filters()).toEqual({ ...NO_FILTERS, rarities: ['Common'] });
      expect(popovers.create).not.toHaveBeenCalled(); // The ✕ doesn't open the chip.

      fixture.detectChanges();
      (root().querySelector('[data-testid="filter-clear-all"]') as HTMLElement).click();
      expect(filters()).toEqual(NO_FILTERS);
      fixture.detectChanges();
      expect(root().querySelector('[data-testid="filter-clear-all"]')).toBeNull();
    });

    it('opens a filter in a popover under its chip', async () => {
      create();

      (root().querySelector('[data-testid="filter-chip-rarity"]') as HTMLElement).click();
      await vi.waitFor(() => {
        expect(present).toHaveBeenCalled();
      });

      expect(popovers.create).toHaveBeenCalledWith(
        expect.objectContaining({
          component: FilterPickerComponent,
          componentProps: { kindProp: 'rarity' },
          cssClass: 'filter-popover',
        })
      );
    });
  });

  describe('FiltersButtonComponent', () => {
    let fixture: ComponentFixture<FiltersButtonComponent>;

    function create(): FiltersButtonComponent {
      fixture = TestBed.createComponent(FiltersButtonComponent);
      fixture.detectChanges();
      return fixture.componentInstance;
    }

    const root = () => fixture.nativeElement as HTMLElement;

    it('counts the picked values in a badge before the button', () => {
      const button = create();
      expect(button.count()).toBe(0);
      expect(root().querySelector('[data-testid="filters-count"]')).toBeNull();

      filters.set({ ...NO_FILTERS, types: ['Fire'], series: ['intl:sv'], sets: ['intl:sv01'] });
      fixture.detectChanges();

      expect(button.count()).toBe(3);
      const badge = root().querySelector('[data-testid="filters-count"]');
      expect(badge?.textContent).toBe('3');
      expect(badge?.nextElementSibling?.getAttribute('data-testid')).toBe('filters-button');
    });

    it('shows search and opens the filters sheet', async () => {
      const button = create();

      await button.open();

      expect(search.activate).toHaveBeenCalled();
      expect(modals.create).toHaveBeenCalledWith(
        expect.objectContaining({
          component: FiltersSheetComponent,
          breakpoints: [0, 1],
          cssClass: 'auto-height-sheet',
        })
      );
      expect(present).toHaveBeenCalled();
    });
  });

  describe('FiltersSheetComponent', () => {
    const dismiss = vi.fn(() => Promise.resolve(true));
    let fixture: ComponentFixture<FiltersSheetComponent>;

    function create(): FiltersSheetComponent {
      TestBed.overrideProvider(ModalController, { useValue: { ...modals, dismiss } });
      fixture = TestBed.createComponent(FiltersSheetComponent);
      fixture.detectChanges();
      return fixture.componentInstance;
    }

    const root = () => fixture.nativeElement as HTMLElement;

    it('lists each filter with its picks, and clears them', () => {
      filters.set({ ...NO_FILTERS, categories: ['Trainer/Item'], sets: ['intl:sv01'] });
      const sheet = create();

      expect(sheet.rows().map((row) => [row.title, row.summary])).toEqual([
        ['Collection', null],
        ['Category', 'Item'],
        ['Type', null],
        ['Rarity', null],
        ['Set', 'Scarlet & Violet'],
      ]);
      expect(root().querySelector('[data-testid="filters-row-type"]')?.textContent).toContain(
        'Any'
      );

      (root().querySelector('[data-testid="filters-clear"]') as HTMLElement).click();
      expect(filters()).toEqual(NO_FILTERS);
      fixture.detectChanges();
      expect(root().querySelector('[data-testid="filters-clear"]')).toBeNull();
    });

    it('opens a filter in a sheet stacked on top, and closes with Done', async () => {
      const sheet = create();

      (root().querySelector('[data-testid="filters-row-set"]') as HTMLElement).click();
      await vi.waitFor(() => {
        expect(present).toHaveBeenCalled();
      });
      expect(modals.create).toHaveBeenCalledWith(
        expect.objectContaining({
          component: FilterPickerComponent,
          componentProps: { kindProp: 'set', sheetProp: true },
          cssClass: 'auto-height-sheet',
        })
      );

      sheet.done();
      expect(dismiss).toHaveBeenCalled();
    });
  });
});
