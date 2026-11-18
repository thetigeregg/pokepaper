import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import {
  IonButton,
  IonChip,
  IonIcon,
  IonLabel,
  ModalController,
  PopoverController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { caretDown, closeCircle } from 'ionicons/icons';
import { localized } from '../../core/services/catalog-browse.service';
import {
  CatalogSearchService,
  hasFilters,
  NO_FILTERS,
} from '../../core/services/catalog-search.service';
import { LayoutService } from '../../core/services/layout.service';
import { FilterPickerComponent } from './filter-picker.component';
import {
  FILTER_KINDS,
  categoryLabel,
  chipLabel,
  kindActive,
  withoutKind,
  type FilterKind,
} from './search-filters';

/**
 * The search filters (docs/ui.md → Cards → Search): a scrolling row of
 * IonChips, one per filter, in the results header. A chip opens its values
 * in an IonPopover on desktop or an IonModal sheet on phones; a chip in use
 * turns primary, shows its values and clears with its ✕.
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
  private readonly layout = inject(LayoutService);
  private readonly modals = inject(ModalController);
  private readonly popovers = inject(PopoverController);

  constructor() {
    addIcons({ caretDown, closeCircle });
  }

  readonly anyActive = computed(() => hasFilters(this.search.filters()));

  readonly chips = computed(() => {
    const filters = this.search.filters();
    const sets = this.search.sets();
    const language = this.search.language();
    const seriesNames = this.search.seriesNames();
    const label = (kind: FilterKind) => (value: string) => {
      switch (kind) {
        case 'category':
          return categoryLabel(value);
        case 'set': {
          const set = sets.get(value)?.set;
          return set ? localized(set.names, language) : (seriesNames.get(value) ?? value);
        }
        default:
          return value;
      }
    };
    return FILTER_KINDS.map((kind) => ({
      kind,
      active: kindActive(filters, kind),
      label: chipLabel(kind, filters, label(kind)),
    }));
  });

  async open(kind: FilterKind, event: Event): Promise<void> {
    const sheet = !this.layout.wide();
    const componentProps = { kindProp: kind, sheetProp: sheet };
    // A sheet on phones, a popover under the chip on desktop.
    const overlay = sheet
      ? await this.modals.create({
          component: FilterPickerComponent,
          componentProps,
          breakpoints: [0, 1],
          initialBreakpoint: 1,
          handle: true,
        })
      : await this.popovers.create({
          component: FilterPickerComponent,
          componentProps,
          event,
          cssClass: 'filter-popover',
        });
    await overlay.present();
  }

  clear(kind: FilterKind, event: Event): void {
    event.stopPropagation(); // Not the chip's own click, which opens it.
    this.search.setFilters(withoutKind(this.search.filters(), kind));
  }

  clearAll(): void {
    this.search.setFilters(NO_FILTERS);
  }
}
