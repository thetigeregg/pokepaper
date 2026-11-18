import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonCheckbox,
  IonContent,
  IonHeader,
  IonItem,
  IonItemDivider,
  IonItemGroup,
  IonList,
  IonNote,
  IonSearchbar,
  IonThumbnail,
  IonTitle,
  IonToolbar,
  ModalController,
  PopoverController,
} from '@ionic/angular';
import { CatalogBrowseService } from '../../core/services/catalog-browse.service';
import {
  CatalogSearchService,
  type SearchFilters,
} from '../../core/services/catalog-search.service';
import { EnergyIconComponent } from './energy-icon.component';
import { RarityIconComponent } from './rarity-icon.component';
import {
  FILTER_FIELDS,
  FILTER_TITLES,
  categoryGroups,
  collectionOptions,
  rarityOptions,
  setGroups,
  typeOptions,
  withPicked,
  type FilterGroup,
  type FilterKind,
  type FilterOption,
} from './search-filters';
import { SetLogoComponent } from './set-logo.component';

/**
 * One filter's values as checkboxes (docs/ui.md → Cards → Search), in an
 * IonModal sheet stacked over the Filters sheet on phones, or an IonPopover
 * under its chip on desktop. Changes apply as
 * they're made. Groups (a category, a series) can be picked as a whole,
 * which covers all their options.
 */
@Component({
  selector: 'app-filter-picker',
  templateUrl: 'filter-picker.component.html',
  styles: [
    `
      :host {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        min-height: 0;
      }
      .sheet-scroll {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
      }
    `,
  ],
  imports: [
    DecimalPipe,
    NgTemplateOutlet,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonSearchbar,
    IonContent,
    IonList,
    IonItemGroup,
    IonItemDivider,
    IonItem,
    IonCheckbox,
    IonNote,
    IonThumbnail,
    EnergyIconComponent,
    RarityIconComponent,
    SetLogoComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilterPickerComponent implements OnInit {
  private readonly search = inject(CatalogSearchService);
  private readonly browse = inject(CatalogBrowseService);
  private readonly modals = inject(ModalController);
  private readonly popovers = inject(PopoverController);

  // Set through componentProps, which assigns plain properties.
  kindProp: FilterKind = 'type';
  /** A phone sheet (over the Filters sheet) rather than a desktop popover. */
  sheetProp = false;

  readonly kind = signal<FilterKind>('type');
  readonly sheet = signal(false);
  readonly title = computed(() => FILTER_TITLES[this.kind()]);
  readonly setQuery = signal('');
  readonly language = this.browse.language;
  /** The searched catalog, for its rarity symbols. */
  readonly region = this.browse.region;

  /**
   * Grouped options (categories, series), or null for a flat list. Only
   * values the search leaves cards for are offered, plus any already picked
   * (see `CatalogSearchService.counts`).
   */
  readonly groups = computed<FilterGroup[] | null>(() => {
    const counts = this.search.counts();
    const filters = this.search.filters();
    switch (this.kind()) {
      case 'category':
        return categoryGroups(withPicked(counts.categories, filters.categories));
      case 'set':
        return setGroups(
          this.browse.groups(),
          this.browse.language(),
          this.setQuery(),
          counts.sets,
          {
            series: filters.series,
            sets: filters.sets,
          }
        );
      default:
        return null;
    }
  });

  readonly options = computed<FilterOption[]>(() => {
    const filters = this.search.filters();
    switch (this.kind()) {
      case 'collection':
        return collectionOptions(this.search.ownedCounts());
      case 'type':
        return typeOptions(withPicked(this.search.counts().types, filters.types));
      case 'rarity':
        return rarityOptions(withPicked(this.search.counts().rarities, filters.rarities));
      default:
        return [];
    }
  });

  private readonly fields = computed(() => FILTER_FIELDS[this.kind()]);
  private readonly picked = computed(() => {
    const filters = this.search.filters();
    const { groups, options } = this.fields();
    return {
      groups: new Set(groups ? filters[groups] : []),
      options: new Set(filters[options]),
    };
  });

  ngOnInit(): void {
    this.kind.set(this.kindProp);
    this.sheet.set(this.sheetProp);
  }

  groupChecked(group: FilterGroup): boolean {
    return this.picked().groups.has(group.value);
  }

  /** Some of a group's options are picked, but not the group itself. */
  groupPartly(group: FilterGroup): boolean {
    return (
      !this.groupChecked(group) &&
      group.options.some((option) => this.picked().options.has(option.value))
    );
  }

  optionChecked(option: FilterOption, group?: FilterGroup): boolean {
    return (group ? this.groupChecked(group) : false) || this.picked().options.has(option.value);
  }

  toggleGroup(group: FilterGroup, on: boolean): void {
    const { groups, options } = this.fields();
    if (!groups) {
      return;
    }
    const children = new Set(group.options.map((option) => option.value));
    this.update((filters) => {
      // Picking the group replaces picks of its options (it covers them).
      const next = {
        ...filters,
        [options]: filters[options].filter((value) => !on || !children.has(value)),
      };
      return {
        ...next,
        [groups]: on
          ? [...next[groups].filter((value) => value !== group.value), group.value]
          : next[groups].filter((value) => value !== group.value),
      };
    });
  }

  toggleOption(option: FilterOption, on: boolean): void {
    const { options } = this.fields();
    this.update((filters) => ({
      ...filters,
      [options]: on
        ? [...filters[options].filter((value) => value !== option.value), option.value]
        : filters[options].filter((value) => value !== option.value),
    }));
  }

  done(): void {
    void (this.sheetProp ? this.modals.dismiss() : this.popovers.dismiss());
  }

  private update(change: (filters: SearchFilters) => SearchFilters): void {
    this.search.setFilters(change(this.search.filters()));
  }
}
