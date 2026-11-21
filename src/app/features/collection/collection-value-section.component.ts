import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { IonItem, IonLabel, IonList, IonListHeader, IonNote } from '@ionic/angular';
import { catalogKey } from '../../core/data/storage-engine';
import { REGION_LABELS } from '../../core/services/catalog-language.service';
import { CatalogPriceService } from '../../core/services/catalog-price.service';
import { CollectionService } from '../../core/services/collection.service';
import { collectionValue, type CatalogValue } from '../../core/utils/catalog-price.util';

/**
 * Settings → Collection value (docs/collection.md → Value): what each
 * catalog's copies are worth at Cardmarket prices, in every language,
 * recalculated whenever the collection or the stored prices change.
 */
@Component({
  selector: 'app-collection-value-section',
  templateUrl: 'collection-value-section.component.html',
  styleUrl: 'collection-value-section.component.scss',
  imports: [
    CurrencyPipe,
    DatePipe,
    DecimalPipe,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollectionValueSectionComponent {
  private readonly collection = inject(CollectionService);
  private readonly priceService = inject(CatalogPriceService);

  readonly regionLabels = REGION_LABELS;
  /** Null until the collection and its prices have been read. */
  readonly values = signal<CatalogValue[] | null>(null);
  /** Set when the prices couldn't be read (until a later read succeeds). */
  readonly failed = signal(false);
  /** The sum over catalogs, shown when more than one has copies. */
  readonly total = computed(() => {
    const values = this.values() ?? [];
    return values.length > 1 ? values.reduce((sum, value) => sum + value.value, 0) : null;
  });
  /** The newest price used, for the footnote. */
  readonly updated = computed(
    () =>
      (this.values() ?? [])
        .map((value) => value.updated)
        .filter((updated) => updated !== null)
        .sort()
        .at(-1) ?? null
  );

  constructor() {
    effect((onCleanup) => {
      if (!this.collection.loaded()) {
        return;
      }
      const entries = this.collection.ownedEntries();
      this.priceService.version();
      let stale = false;
      onCleanup(() => {
        stale = true;
      });
      const keys = [...new Set(entries.map((entry) => catalogKey(entry.region, entry.cardId)))];
      this.priceService
        .pricesByKey(keys)
        .then((prices) => {
          if (!stale) {
            this.values.set(collectionValue(entries, prices));
            this.failed.set(false);
          }
        })
        .catch((error: unknown) => {
          console.error('collection.value_failed', error);
          if (!stale) {
            this.failed.set(true);
          }
        });
    });
  }
}
