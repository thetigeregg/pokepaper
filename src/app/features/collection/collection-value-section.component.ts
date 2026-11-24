import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import {
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSelect,
  IonSelectOption,
} from '@ionic/angular';
import { catalogKey } from '../../core/data/storage-engine';
import { REGION_LABELS } from '../../core/services/catalog-language.service';
import { CatalogPriceService } from '../../core/services/catalog-price.service';
import { CollectionService } from '../../core/services/collection.service';
import { CurrencyService } from '../../core/services/currency.service';
import { collectionValue, type CatalogValue } from '../../core/utils/catalog-price.util';

/**
 * Settings → Collection value (docs/collection.md → Value): what each
 * catalog's copies are worth at Cardmarket prices, in every language,
 * recalculated whenever the collection or the stored prices change. Its
 * Currency row picks the currency every price is shown in.
 */
@Component({
  selector: 'app-collection-value-section',
  templateUrl: 'collection-value-section.component.html',
  imports: [
    DatePipe,
    DecimalPipe,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
    IonSelect,
    IonSelectOption,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollectionValueSectionComponent {
  private readonly collection = inject(CollectionService);
  private readonly priceService = inject(CatalogPriceService);
  private readonly currencyService = inject(CurrencyService);

  readonly regionLabels = REGION_LABELS;
  /** The picked currency (the Currency row's value) and the ones offered. */
  readonly preferredCurrency = this.currencyService.preferred;
  readonly currencyOptions = this.currencyService.options;
  /** The ECB rates' day when values are converted from euros, else null. */
  readonly convertedOn = computed(() =>
    this.currencyService.currency() === 'EUR' ? null : (this.currencyService.rates()?.date ?? null)
  );
  /** Set when the picked currency has no rate yet, so values are still in euros. */
  readonly awaitingRates = computed(
    () => this.currencyService.preferred() !== this.currencyService.currency()
  );
  /** Null until the collection and its prices have been read. */
  readonly values = signal<CatalogValue[] | null>(null);
  /** Set when the prices couldn't be read (until a later read succeeds). */
  readonly failed = signal(false);
  /** The sum over catalogs (even €0), shown when more than one has copies. */
  readonly total = computed(() => {
    const values = this.values() ?? [];
    return values.length > 1
      ? { amount: values.reduce((sum, value) => sum + value.value, 0) }
      : null;
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
      Promise.all([this.priceService.pricesByKey(keys), this.priceService.setsBeforeReverseHolos()])
        .then(([prices, earlySets]) => {
          if (!stale) {
            this.values.set(collectionValue(entries, prices, earlySets));
            this.failed.set(false);
          }
        })
        .catch((error: unknown) => {
          console.error('collection.value_failed', error);
          if (!stale) {
            // Not the earlier values: they'd look current.
            this.values.set(null);
            this.failed.set(true);
          }
        });
    });
  }

  /** An amount in euros, in the picked currency ("CHF 2,163.20"). */
  money(euros: number): string {
    return this.currencyService.format(euros);
  }

  pickCurrency(code: unknown): void {
    if (typeof code === 'string') {
      void this.currencyService.pick(code);
    }
  }
}
