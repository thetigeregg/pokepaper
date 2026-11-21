import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { CatalogCardPrices, CollectionEntry } from '@pokepaper/shared';
import { vi } from 'vitest';
import { CatalogPriceService } from '../../core/services/catalog-price.service';
import { CollectionService, type ShownEntry } from '../../core/services/collection.service';
import { CurrencyService, formatMoney } from '../../core/services/currency.service';
import { CollectionValueSectionComponent } from './collection-value-section.component';

describe('CollectionValueSectionComponent', () => {
  const loaded = signal(false);
  const ownedEntries = signal<ShownEntry[]>([]);
  let stored: Map<string, CatalogCardPrices>;
  const priceService = {
    version: signal(0),
    pricesByKey: vi.fn((keys: readonly string[]) =>
      Promise.resolve(
        new Map(keys.flatMap((key) => (stored.has(key) ? [[key, stored.get(key)]] : [])))
      )
    ),
  };

  const preferred = signal('EUR');
  const shown = signal('EUR');
  let rate = 1;
  const currencyService = {
    preferred,
    currency: shown,
    rates: signal({ date: '2026-11-20', rates: { CHF: 0.9 } }),
    options: signal([
      { code: 'EUR', name: 'Euro' },
      { code: 'CHF', name: 'Swiss Franc' },
    ]),
    format: (euros: number) => formatMoney(euros * rate, shown()),
    pick: vi.fn(() => Promise.resolve()),
  };

  const entry = (overrides: Partial<CollectionEntry>): ShownEntry =>
    ({
      region: 'intl',
      cardId: 'sv01-001',
      setId: 'sv01',
      variant: 'normal',
      language: 'en',
      quantity: 1,
      ...overrides,
    }) as ShownEntry;
  const prices = (trend: number, updated = '2026-11-21T05:47:42.306Z'): CatalogCardPrices => ({
    updated,
    base: { trend, avg7: null, avg30: null },
    reverseHolo: null,
  });

  function create(): ComponentFixture<CollectionValueSectionComponent> {
    const fixture = TestBed.createComponent(CollectionValueSectionComponent);
    fixture.detectChanges();
    return fixture;
  }
  const element = (fixture: ComponentFixture<CollectionValueSectionComponent>) =>
    fixture.nativeElement as HTMLElement;
  const text = (fixture: ComponentFixture<CollectionValueSectionComponent>, testId: string) =>
    element(fixture)
      .querySelector(`[data-testid="${testId}"]`)
      ?.textContent.replace(/\s+/g, ' ')
      .trim();
  /** Lets the prices load (native async isn't tracked by zone.js). */
  const settle = async (fixture: ComponentFixture<CollectionValueSectionComponent>) => {
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  };

  beforeEach(() => {
    loaded.set(true);
    preferred.set('EUR');
    shown.set('EUR');
    rate = 1;
    currencyService.pick.mockClear();
    ownedEntries.set([]);
    stored = new Map();
    priceService.version.set(0);
    priceService.pricesByKey.mockClear();
    TestBed.configureTestingModule({
      providers: [
        { provide: CollectionService, useValue: { loaded, ownedEntries } },
        { provide: CatalogPriceService, useValue: priceService },
        { provide: CurrencyService, useValue: currencyService },
      ],
    });
  });

  it('values each catalog’s copies, in every language', async () => {
    ownedEntries.set([
      entry({ quantity: 2 }),
      entry({ language: 'de', quantity: 1 }),
      entry({ cardId: 'sv01-002', variant: 'firstEdition' }),
      entry({ region: 'asia', cardId: 'SV2a-001', language: 'ja', quantity: 3 }),
    ]);
    stored.set('intl:sv01-001', prices(1.5, '2026-11-22T00:00:00.000Z'));
    stored.set('intl:sv01-002', prices(9));
    stored.set('asia:SV2a-001', prices(0.5));
    const fixture = create();
    await settle(fixture);

    expect(priceService.pricesByKey).toHaveBeenCalledWith([
      'intl:sv01-001',
      'intl:sv01-002',
      'asia:SV2a-001',
    ]);
    expect(text(fixture, 'value-intl')).toBe('International 4 cards · 1 without a price €4.50');
    expect(text(fixture, 'value-asia')).toBe('Japan & Asia 3 cards €1.50');
    expect(text(fixture, 'value-total')).toBe('Total €6.00');
    expect(text(fixture, 'value-note')).toBe(
      'Cardmarket price trends in euros, for any language and condition. Updated Nov 22, 2026.'
    );
  });

  it('shows values in the picked currency, noting the conversion', async () => {
    preferred.set('CHF');
    shown.set('CHF');
    rate = 0.9;
    ownedEntries.set([entry({ quantity: 2 })]);
    stored.set('intl:sv01-001', prices(10));
    const fixture = create();
    await settle(fixture);

    // `text` normalizes whitespace, the no-break space after CHF too.
    expect(text(fixture, 'value-intl')).toBe('International 2 cards CHF 18.00');
    expect(text(fixture, 'value-note')).toBe(
      'Cardmarket price trends for any language and condition, converted from euros at the ECB rate of Nov 20, 2026. Updated Nov 21, 2026.'
    );
  });

  it('says values stay in euros until the picked currency’s rate is downloaded', async () => {
    preferred.set('CHF');
    ownedEntries.set([entry({})]);
    stored.set('intl:sv01-001', prices(1));
    const fixture = create();
    await settle(fixture);

    expect(text(fixture, 'value-intl')).toBe('International 1 card €1.00');
    expect(text(fixture, 'value-note')).toContain(
      'Shown in euros until exchange rates are downloaded.'
    );
  });

  it('offers every currency in its Currency row and saves a pick', async () => {
    const fixture = create();
    await settle(fixture);
    const select = element(fixture).querySelector<HTMLIonSelectElement>(
      '[data-testid="value-currency"] ion-select'
    );

    expect(select?.value).toBe('EUR');
    expect(
      [
        ...element(fixture).querySelectorAll('[data-testid="value-currency"] ion-select-option'),
      ].map((option) => option.textContent.trim())
    ).toEqual(['Euro (EUR)', 'Swiss Franc (CHF)']);

    fixture.componentInstance.pickCurrency('CHF');
    expect(currencyService.pick).toHaveBeenCalledWith('CHF');
  });

  it('totals both catalogs even when nothing is priced', async () => {
    ownedEntries.set([
      entry({ variant: 'firstEdition' }),
      entry({ region: 'asia', cardId: 'SV2a-001', language: 'ja' }),
    ]);
    const fixture = create();
    await settle(fixture);

    expect(text(fixture, 'value-total')).toBe('Total €0.00');
  });

  it('drops values it can no longer read instead of showing them as current', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    ownedEntries.set([entry({})]);
    stored.set('intl:sv01-001', prices(1));
    const fixture = create();
    await settle(fixture);
    expect(text(fixture, 'value-intl')).toBe('International 1 card €1.00');

    priceService.pricesByKey.mockRejectedValueOnce(new Error('disk'));
    ownedEntries.set([entry({ quantity: 2 })]);
    await settle(fixture);

    expect(text(fixture, 'value-intl')).toBeUndefined();
    expect(text(fixture, 'value-failed')).toBe('Couldn’t read the prices on this device');
    error.mockRestore();
  });

  it('has no total with one catalog', async () => {
    ownedEntries.set([entry({ quantity: 1 })]);
    stored.set('intl:sv01-001', prices(1234.5));
    const fixture = create();
    await settle(fixture);

    expect(text(fixture, 'value-intl')).toBe('International 1 card €1,234.50');
    expect(text(fixture, 'value-total')).toBeUndefined();
  });

  it('says so when the collection is empty', async () => {
    const fixture = create();
    await settle(fixture);

    expect(text(fixture, 'value-empty')).toBe('No cards in your collection yet');
    expect(text(fixture, 'value-note')).toBeUndefined();
  });

  it('waits for the collection to load', async () => {
    loaded.set(false);
    const fixture = create();
    await settle(fixture);

    expect(priceService.pricesByKey).not.toHaveBeenCalled();
    expect(element(fixture).textContent).toContain('Calculating…');
  });

  it('recalculates when the collection or the stored prices change', async () => {
    ownedEntries.set([entry({ quantity: 1 })]);
    stored.set('intl:sv01-001', prices(1));
    const fixture = create();
    await settle(fixture);
    expect(text(fixture, 'value-intl')).toBe('International 1 card €1.00');

    ownedEntries.set([entry({ quantity: 3 })]);
    await settle(fixture);
    expect(text(fixture, 'value-intl')).toBe('International 3 cards €3.00');

    stored.set('intl:sv01-001', prices(2));
    priceService.version.set(1);
    await settle(fixture);
    expect(text(fixture, 'value-intl')).toBe('International 3 cards €6.00');
  });

  it('logs prices that can’t be read', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    priceService.pricesByKey.mockRejectedValueOnce(new Error('disk'));
    ownedEntries.set([entry({})]);
    const fixture = create();
    await settle(fixture);

    expect(error).toHaveBeenCalledWith('collection.value_failed', expect.any(Error));
    expect(text(fixture, 'value-failed')).toBe('Couldn’t read the prices on this device');
    error.mockRestore();
  });
});
