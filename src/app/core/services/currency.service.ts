import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { isCurrencyCode, isExchangeRates, type ExchangeRates } from '@pokepaper/shared';
import { StorageEngineFactory } from '../data/storage-engine.factory';
import { CatalogSyncService, EXCHANGE_RATES_KEY } from './catalog-sync.service';
import { UserSettingsService } from './user-settings.service';

/** A currency the user can pick: its code and English name ("Swiss Franc"). */
export interface CurrencyOption {
  code: string;
  name: string;
}

const CURRENCY_NAMES = new Intl.DisplayNames(['en'], { type: 'currency' });
const formatters = new Map<string, Intl.NumberFormat>();

/** "€0.14", "CHF 0.13", "¥17": amounts in `currency`, in US English. */
export function formatMoney(amount: number, currency: string): string {
  let formatter = formatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency });
    formatters.set(currency, formatter);
  }
  return formatter.format(amount);
}

/** A currency's English name, or its code when the browser has none. */
export function currencyName(code: string): string {
  return CURRENCY_NAMES.of(code) ?? code;
}

/**
 * The currency prices are shown in (docs/catalog.md → Currencies): picked
 * in Settings and synced with the user's settings, converted from euros at
 * the ECB rates the catalog sync stores. Without a rate for the picked
 * currency (none downloaded yet), prices stay in euros.
 */
@Injectable({ providedIn: 'root' })
export class CurrencyService {
  private readonly userSettings = inject(UserSettingsService);
  private readonly storageEngineFactory = inject(StorageEngineFactory);
  private readonly _rates = signal<ExchangeRates | null>(null);

  /** The rates on this device; null until read, or when none were downloaded. */
  readonly rates = this._rates.asReadonly();
  /** The picked currency; euros when none is. */
  readonly preferred = computed(() => {
    const currency = this.userSettings.settings().currency;
    return isCurrencyCode(currency) ? currency : 'EUR';
  });
  /** The currency amounts are shown in: the picked one when its rate is known, else euros. */
  readonly currency = computed(() => {
    const preferred = this.preferred();
    return preferred === 'EUR' || this.rate(preferred) !== null ? preferred : 'EUR';
  });
  /** Euros, every currency with a rate, and the picked one, by English name. */
  readonly options = computed<CurrencyOption[]>(() => {
    const codes = new Set(['EUR', this.preferred(), ...Object.keys(this._rates()?.rates ?? {})]);
    return [...codes]
      .map((code) => ({ code, name: currencyName(code) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  constructor() {
    void this.load();
    inject(CatalogSyncService)
      .ratesChanged$.pipe(takeUntilDestroyed())
      .subscribe(() => {
        void this.load();
      });
  }

  /** `euros` in the shown currency, formatted ("CHF 0.13"). */
  format(euros: number): string {
    const currency = this.currency();
    return formatMoney(euros * (this.rate(currency) ?? 1), currency);
  }

  /** Shows prices in `code` from now on, on every device. */
  async pick(code: string): Promise<void> {
    if (!isCurrencyCode(code) || code === this.preferred()) {
      return;
    }
    await this.userSettings.update(
      (settings) => ({ ...settings, currency: code }),
      'currency.save_failed'
    );
  }

  /** Units of `currency` per euro: 1 for euros, null without a rate. */
  private rate(currency: string): number | null {
    return currency === 'EUR' ? 1 : (this._rates()?.rates[currency] ?? null);
  }

  private async load(): Promise<void> {
    try {
      const stored = await this.storageEngineFactory.getEngine().getSyncMeta(EXCHANGE_RATES_KEY);
      const rates: unknown = stored ? JSON.parse(stored.value) : null;
      this._rates.set(isExchangeRates(rates) ? rates : null);
    } catch (error: unknown) {
      console.error('currency.rates_load_failed', error);
    }
  }
}
