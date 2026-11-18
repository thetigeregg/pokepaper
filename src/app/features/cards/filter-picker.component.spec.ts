import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ModalController, PopoverController } from '@ionic/angular';
import { vi } from 'vitest';
import { makeContractPack } from '../../core/data/storage-engine.contract';
import { CatalogBrowseService } from '../../core/services/catalog-browse.service';
import {
  CatalogSearchService,
  NO_FILTERS,
  type SearchFilters,
} from '../../core/services/catalog-search.service';
import { ImageCacheService } from '../../core/services/image-cache.service';
import { VisibilityService } from '../../core/services/visibility.service';
import { FilterPickerComponent } from './filter-picker.component';
import type { FilterKind } from './search-filters';

describe('FilterPickerComponent', () => {
  const filters = signal<SearchFilters>(NO_FILTERS);
  const search = {
    filters,
    setFilters: vi.fn((next: SearchFilters) => {
      filters.set(next);
    }),
    counts: signal({
      categories: [
        { value: 'Pokemon', count: 30 },
        { value: 'Trainer', count: 10 },
        { value: 'Trainer/Supporter', count: 6 },
        { value: 'Trainer/Item', count: 4 },
      ],
      types: [
        { value: 'Water', count: 5 },
        { value: 'Fire', count: 3 },
      ],
      rarities: [{ value: 'Common', count: 1200 }],
      sets: new Map([
        ['intl:sv01', 7],
        ['intl:sv02', 2],
      ]),
      owned: [
        { value: 'owned', count: 0 },
        { value: 'missing', count: 42 },
      ],
    }),
  };
  const sv01 = { ...makeContractPack('intl', 'sv01', []).set, names: { en: 'Scarlet & Violet' } };
  const sv02 = { ...makeContractPack('intl', 'sv02', []).set, names: { en: 'Paldea Evolved' } };
  const browse = {
    language: signal('en'),
    groups: signal([{ key: 'intl:sv', name: 'Scarlet & Violet', sets: [sv02, sv01] }]),
  };
  const modals = { dismiss: vi.fn(() => Promise.resolve(true)) };
  const popovers = { dismiss: vi.fn(() => Promise.resolve(true)) };

  let fixture: ComponentFixture<FilterPickerComponent>;

  function create(kind: FilterKind, sheet = true): FilterPickerComponent {
    fixture = TestBed.createComponent(FilterPickerComponent);
    fixture.componentInstance.kindProp = kind;
    fixture.componentInstance.sheetProp = sheet;
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  const root = () => fixture.nativeElement as HTMLElement;
  const testIds = (prefix: string) =>
    [...root().querySelectorAll(`[data-testid^="${prefix}"]`)].map((element) =>
      element.getAttribute('data-testid')
    );

  beforeEach(() => {
    vi.clearAllMocks();
    filters.set(NO_FILTERS);
    TestBed.configureTestingModule({
      providers: [
        { provide: CatalogSearchService, useValue: search },
        { provide: CatalogBrowseService, useValue: browse },
        { provide: ModalController, useValue: modals },
        { provide: PopoverController, useValue: popovers },
        {
          provide: ImageCacheService,
          useValue: { resolve: vi.fn(() => Promise.resolve(null)), release: vi.fn() },
        },
        { provide: VisibilityService, useValue: { whenVisible: () => () => undefined } },
      ],
    });
  });

  it('lists a flat filter with its counts', () => {
    const picker = create('type');

    expect(picker.title()).toBe('Type');
    expect(testIds('filter-option-')).toEqual(['filter-option-Fire', 'filter-option-Water']);
    expect(root().querySelector('app-energy-icon')).not.toBeNull();
    expect(root().querySelector('ion-note')?.textContent).toBe('3');
  });

  it('picks and unpicks values, keeping other filters', () => {
    filters.set({ ...NO_FILTERS, rarities: ['Common'] });
    const picker = create('type');
    const [fire, water] = picker.options();

    picker.toggleOption(fire, true);
    picker.toggleOption(water, true);
    picker.toggleOption(fire, true); // Already picked: not repeated.
    expect(filters()).toEqual({ ...NO_FILTERS, rarities: ['Common'], types: ['Water', 'Fire'] });
    expect(picker.optionChecked(fire)).toBe(true);

    picker.toggleOption(water, false);
    expect(filters().types).toEqual(['Fire']);
  });

  it('picks a whole category, covering its subtypes', () => {
    const picker = create('category');
    const trainer = picker.groups()?.[1];
    if (!trainer) {
      throw new Error('no Trainer group');
    }
    expect(testIds('filter-group-')).toEqual(['filter-group-Pokemon', 'filter-group-Trainer']);
    expect(trainer.options.map((option) => option.value)).toEqual([
      'Trainer/Supporter',
      'Trainer/Item',
    ]);

    picker.toggleOption(trainer.options[0], true);
    expect(picker.groupPartly(trainer)).toBe(true);

    picker.toggleGroup(trainer, true);
    expect(filters().categories).toEqual(['Trainer']);
    expect(picker.groupChecked(trainer)).toBe(true);
    expect(picker.groupPartly(trainer)).toBe(false);
    expect(picker.optionChecked(trainer.options[1], trainer)).toBe(true);

    picker.toggleGroup(trainer, false);
    expect(filters().categories).toEqual([]);
  });

  it('picks series and sets, and searches the set names', () => {
    const picker = create('set');
    const series = picker.groups()?.[0];
    if (!series) {
      throw new Error('no series');
    }
    expect(testIds('filter-option-')).toEqual([
      'filter-option-intl:sv02',
      'filter-option-intl:sv01',
    ]);
    expect(root().querySelector('[data-testid="set-search"]')).not.toBeNull();

    picker.toggleOption(series.options[1], true);
    expect(filters()).toEqual({ ...NO_FILTERS, sets: ['intl:sv01'] });
    picker.toggleGroup(series, true);
    expect(filters()).toEqual({ ...NO_FILTERS, series: ['intl:sv'] });

    picker.setQuery.set('paldea');
    fixture.detectChanges();
    expect(testIds('filter-option-')).toEqual(['filter-option-intl:sv02']);
    picker.setQuery.set('nothing like it');
    fixture.detectChanges();
    expect(root().querySelector('[data-testid="filter-empty"]')).not.toBeNull();
  });

  it('keeps picked values the search has no cards for, at 0', () => {
    filters.set({ ...NO_FILTERS, types: ['Grass'], categories: ['Energy/Special'] });

    expect(
      create('type')
        .options()
        .map((option) => [option.value, option.count])
    ).toEqual([
      ['Grass', 0],
      ['Fire', 3],
      ['Water', 5],
    ]);
    expect(
      create('category')
        .groups()
        ?.map((group) => group.value)
    ).toEqual(['Pokemon', 'Trainer', 'Energy']);
  });

  it('says when the search leaves a filter no values', () => {
    search.counts.update((counts) => ({ ...counts, rarities: [] }));
    create('rarity');

    expect(root().querySelector('[data-testid="filter-empty"]')).not.toBeNull();
    search.counts.update((counts) => ({ ...counts, rarities: [{ value: 'Common', count: 1200 }] }));
  });

  it('ignores whole-group picks for filters without groups', () => {
    const picker = create('rarity');

    picker.toggleGroup({ value: 'x', label: 'x', options: [] }, true);

    expect(search.setFilters).not.toHaveBeenCalled();
    expect(picker.groups()).toBeNull();
  });

  it('closes its sheet or its popover', () => {
    create('type', true).done();
    expect(modals.dismiss).toHaveBeenCalled();

    create('type', false).done();
    expect(popovers.dismiss).toHaveBeenCalled();
  });

  it('offers Owned and Missing for the collection, even with none owned, and picks them', () => {
    const picker = create('collection');

    expect(picker.title()).toBe('Collection');
    expect(testIds('filter-option-')).toEqual(['filter-option-owned', 'filter-option-missing']);
    expect(picker.options().map((option) => [option.label, option.count])).toEqual([
      ['Owned', 0],
      ['Missing', 42],
    ]);

    picker.toggleOption(picker.options()[1], true);
    expect(filters()).toEqual({ ...NO_FILTERS, owned: ['missing'] });
    picker.toggleOption(picker.options()[1], false);
    expect(filters()).toEqual(NO_FILTERS);
  });
});
