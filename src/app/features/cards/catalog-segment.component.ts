import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IonLabel, IonSegment, IonSegmentButton } from '@ionic/angular';
import type { CatalogRegion } from '@pokepaper/shared';
import { CatalogBrowseService } from '../../core/services/catalog-browse.service';

/** IonSegment switching the Cards tab between the international and Asian catalogs. */
@Component({
  selector: 'app-catalog-segment',
  // Full toolbar width, so the segment can be centered in it.
  host: { class: 'ion-display-flex ion-justify-content-center' },
  styles: [':host { width: 100%; }'],
  template: `
    <ion-segment
      [value]="browse.region()"
      (ionChange)="select($event.detail.value)"
      data-testid="catalog-segment"
    >
      <ion-segment-button value="intl"><ion-label>International</ion-label></ion-segment-button>
      <ion-segment-button value="asia"><ion-label>Japan &amp; Asia</ion-label></ion-segment-button>
    </ion-segment>
  `,
  imports: [IonSegment, IonSegmentButton, IonLabel],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogSegmentComponent {
  readonly browse = inject(CatalogBrowseService);

  select(value: unknown): void {
    if (value === 'intl' || value === 'asia') {
      void this.browse.setRegion(value satisfies CatalogRegion);
    }
  }
}
