import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { IonBadge, IonButton, IonIcon, ModalController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { optionsOutline } from 'ionicons/icons';
import { CatalogSearchService } from '../../core/services/catalog-search.service';
import { FiltersSheetComponent } from './filters-sheet.component';
import { FILTER_KINDS, pickedValues } from './search-filters';

/**
 * The phone Filters button (docs/ui.md → Cards → Search), in the Cards title
 * toolbar: an icon IonButton, with an IonBadge to its left counting the
 * picked values. It shows search and opens the filters sheet.
 */
@Component({
  selector: 'app-filters-button',
  // The badge sits left of the button, so the button never moves.
  host: { class: 'ion-display-flex ion-align-items-center' },
  template: `
    @if (count(); as count) {
      <ion-badge aria-hidden="true" data-testid="filters-count">{{ count }}</ion-badge>
    }
    <ion-button
      (click)="open()"
      [attr.aria-label]="count() ? 'Filters, ' + count() + ' picked' : 'Filters'"
      data-testid="filters-button"
    >
      <ion-icon slot="icon-only" name="options-outline"></ion-icon>
    </ion-button>
  `,
  imports: [IonButton, IonIcon, IonBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FiltersButtonComponent {
  private readonly search = inject(CatalogSearchService);
  private readonly modals = inject(ModalController);

  constructor() {
    addIcons({ optionsOutline });
  }

  readonly count = computed(() => {
    const filters = this.search.filters();
    return FILTER_KINDS.reduce((total, kind) => total + pickedValues(filters, kind).length, 0);
  });

  async open(): Promise<void> {
    this.search.activate();
    const modal = await this.modals.create({
      component: FiltersSheetComponent,
      breakpoints: [0, 1],
      initialBreakpoint: 1,
      handle: true,
      cssClass: 'auto-height-sheet',
    });
    await modal.present();
  }
}
