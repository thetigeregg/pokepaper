import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { CatalogCardPrices, CollectionEntry } from '@pokepaper/shared';
import { vi } from 'vitest';
import { CatalogPriceService } from '../../core/services/catalog-price.service';
import { CollectionService, type ShownEntry } from '../../core/services/collection.service';
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
    ownedEntries.set([]);
    stored = new Map();
    priceService.version.set(0);
    priceService.pricesByKey.mockClear();
    TestBed.configureTestingModule({
      providers: [
        { provide: CollectionService, useValue: { loaded, ownedEntries } },
        { provide: CatalogPriceService, useValue: priceService },
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
