import { ChangeDetectionStrategy, Component, Injector, computed, inject } from '@angular/core';
import { IonBadge, IonButton, IonIcon, ModalController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { optionsOutline } from 'ionicons/icons';
import { CatalogSearchService } from '../../core/services/catalog-search.service';
import { FiltersSheetComponent } from './filters-sheet.component';
import { FILTER_KINDS, pickedValues } from './search-filters';

/**
 * The phone Filters button (docs/ui.md → Cards → Search), in the Cards title
 * toolbar: an icon IonButton with an IonBadge on the icon's top-right corner
 * counting the picked values. It shows search and opens the filters sheet.
 */
@Component({
  selector: 'app-filters-button',
  styles: [
    `
      :host {
        position: relative;
        display: inline-block;
      }
      /* On the icon's corner, over the button; taps go to the button. */
      .count {
        position: absolute;
        top: 2px;
        right: 0;
        min-width: 16px;
        padding: 2px 4px;
        font-size: 0.65rem;
        pointer-events: none;
      }
    `,
  ],
  template: `
    <ion-button
      (click)="open()"
      [attr.aria-label]="count() ? 'Filters, ' + count() + ' picked' : 'Filters'"
      data-testid="filters-button"
    >
      <ion-icon slot="icon-only" name="options-outline"></ion-icon>
    </ion-button>
    @if (count(); as count) {
      <ion-badge class="count" aria-hidden="true" data-testid="filters-count">
        {{ count }}
      </ion-badge>
    }
  `,
  imports: [IonButton, IonIcon, IonBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FiltersButtonComponent {
  private readonly search = inject(CatalogSearchService);
  private readonly modals = inject(ModalController);
  /** Opens overlays in this search's injector, so they use the same `CatalogSearchService`. */
  private readonly injector = inject(Injector);

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
      injector: this.injector,
      breakpoints: [0, 1],
      initialBreakpoint: 1,
      handle: true,
      cssClass: 'auto-height-sheet',
    });
    await modal.present();
  }
}
