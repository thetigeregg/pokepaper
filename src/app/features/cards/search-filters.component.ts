import { ChangeDetectionStrategy, Component, Injector, computed, inject } from '@angular/core';
import { IonButton, IonChip, IonIcon, IonLabel, PopoverController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { caretDown, closeCircle } from 'ionicons/icons';
import {
  CatalogSearchService,
  hasFilters,
  NO_FILTERS,
} from '../../core/services/catalog-search.service';
import { FilterPickerComponent } from './filter-picker.component';
import {
  FILTER_KINDS,
  chipLabel,
  kindActive,
  valueLabel,
  withoutKind,
  type FilterKind,
} from './search-filters';

/**
 * The desktop search filters (docs/ui.md → Cards → Search): a row of
 * IonChips, one per filter, in the results header. A chip opens its values
 * in an IonPopover; a chip in use turns primary, shows its values and
 * clears with its ✕. Phones use the Filters button instead.
 */
@Component({
  selector: 'app-search-filters',
  styles: [
    `
      :host {
        display: block;
      }
      .chips {
        display: flex;
        align-items: center;
        overflow-x: auto;
        scrollbar-width: none;
        padding-inline: 8px;
      }
      ion-chip {
        flex-shrink: 0;
      }
    `,
  ],
  template: `
    <div class="chips">
      @for (chip of chips(); track chip.kind) {
        <ion-chip
          [outline]="!chip.active"
          [color]="chip.active ? 'primary' : undefined"
          (click)="open(chip.kind, $event)"
          [attr.data-testid]="'filter-chip-' + chip.kind"
        >
          <ion-label>{{ chip.label }}</ion-label>
          @if (chip.active) {
            <ion-icon
              name="close-circle"
              role="button"
              [attr.aria-label]="'Clear ' + chip.label"
              (click)="clear(chip.kind, $event)"
              [attr.data-testid]="'filter-clear-' + chip.kind"
            ></ion-icon>
          } @else {
            <ion-icon name="caret-down" aria-hidden="true"></ion-icon>
          }
        </ion-chip>
      }
      @if (anyActive()) {
        <ion-button fill="clear" size="small" (click)="clearAll()" data-testid="filter-clear-all">
          Clear
        </ion-button>
      }
    </div>
  `,
  imports: [IonChip, IonLabel, IonIcon, IonButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchFiltersComponent {
  private readonly search = inject(CatalogSearchService);
  private readonly popovers = inject(PopoverController);
  /** Opens overlays in this search's injector, so they use the same `CatalogSearchService`. */
  private readonly injector = inject(Injector);

  constructor() {
    addIcons({ caretDown, closeCircle });
  }

  readonly anyActive = computed(() => hasFilters(this.search.filters()));

  readonly chips = computed(() => {
    const filters = this.search.filters();
    const names = this.search.setNames();
    return FILTER_KINDS.map((kind) => ({
      kind,
      active: kindActive(filters, kind),
      label: chipLabel(kind, filters, valueLabel(kind, names)),
    }));
  });

  async open(kind: FilterKind, event: Event): Promise<void> {
    const popover = await this.popovers.create({
      component: FilterPickerComponent,
      componentProps: { kindProp: kind },
      injector: this.injector,
      event,
      cssClass: 'filter-popover',
    });
    await popover.present();
  }

  clear(kind: FilterKind, event: Event): void {
    event.stopPropagation(); // Not the chip's own click, which opens it.
    this.search.setFilters(withoutKind(this.search.filters(), kind));
  }

  clearAll(): void {
    this.search.setFilters(NO_FILTERS);
  }
}
