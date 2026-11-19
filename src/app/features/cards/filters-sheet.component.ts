import { ChangeDetectionStrategy, Component, Injector, computed, inject } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular';
import {
  CatalogSearchService,
  hasFilters,
  NO_FILTERS,
} from '../../core/services/catalog-search.service';
import { FilterPickerComponent } from './filter-picker.component';
import {
  FILTER_KINDS,
  FILTER_TITLES,
  filterSummary,
  valueLabel,
  type FilterKind,
} from './search-filters';

/**
 * The phone filters sheet (docs/ui.md → Cards → Search), opened by the
 * Filters button: each filter as a row showing its picks, opening its picker
 * in a sheet stacked on top, and "Clear filters". Both are auto-height
 * IonModal sheets, as tall as what they show.
 */
@Component({
  selector: 'app-filters-sheet',
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Filters</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="done()" data-testid="filters-done">Done</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-list>
      @for (row of rows(); track row.kind) {
        <ion-item
          button="true"
          [detail]="true"
          lines="inset"
          (click)="open(row.kind)"
          [attr.data-testid]="'filters-row-' + row.kind"
        >
          <ion-label>{{ row.title }}</ion-label>
          <ion-note slot="end" [color]="row.summary ? 'primary' : undefined">
            {{ row.summary ?? 'Any' }}
          </ion-note>
        </ion-item>
      }
      @if (anyActive()) {
        <ion-item button="true" [detail]="false" (click)="clear()" data-testid="filters-clear">
          <ion-label color="danger">Clear filters</ion-label>
        </ion-item>
      }
    </ion-list>
  `,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonList,
    IonItem,
    IonLabel,
    IonNote,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FiltersSheetComponent {
  private readonly search = inject(CatalogSearchService);
  private readonly modals = inject(ModalController);
  /** Opens overlays in this search's injector, so they use the same `CatalogSearchService`. */
  private readonly injector = inject(Injector);

  readonly anyActive = computed(() => hasFilters(this.search.filters()));

  readonly rows = computed(() => {
    const filters = this.search.filters();
    const names = this.search.setNames();
    return FILTER_KINDS.map((kind) => ({
      kind,
      title: FILTER_TITLES[kind],
      summary: filterSummary(kind, filters, valueLabel(kind, names)),
    }));
  });

  /** Opens a filter's picker in a sheet stacked over this one; Done or a swipe returns here. */
  async open(kind: FilterKind): Promise<void> {
    const sheet = await this.modals.create({
      component: FilterPickerComponent,
      componentProps: { kindProp: kind, sheetProp: true },
      injector: this.injector,
      breakpoints: [0, 1],
      initialBreakpoint: 1,
      handle: true,
      cssClass: 'auto-height-sheet',
    });
    await sheet.present();
  }

  clear(): void {
    this.search.setFilters(NO_FILTERS);
  }

  done(): void {
    void this.modals.dismiss();
  }
}
