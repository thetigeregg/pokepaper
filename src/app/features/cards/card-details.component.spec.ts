import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  collectionEntry,
  collectionEntryId,
  type CatalogCard,
  type CatalogCardPrices,
  type CatalogCardText,
  type CatalogSet,
  type CollectionChange,
  type CollectionEntry,
} from '@pokepaper/shared';
import { NEVER } from 'rxjs';
import { vi } from 'vitest';
import { LocalUserDataRepository } from '../../core/data/local-user-data-repository';
import { makeContractCard, makeContractPack } from '../../core/data/storage-engine.contract';
import { CatalogPriceService } from '../../core/services/catalog-price.service';
import { CurrencyService, formatMoney } from '../../core/services/currency.service';
import { ImageCacheService } from '../../core/services/image-cache.service';
import { SyncService } from '../../core/services/sync.service';
import { VisibilityService } from '../../core/services/visibility.service';
import { ModalController } from '@ionic/angular';
import { LayoutService } from '../../core/services/layout.service';
import { CardDetailsComponent } from './card-details.component';
import { CardmarketMatcherComponent } from './cardmarket-matcher.component';

describe('CardDetailsComponent', () => {
  const base = makeContractCard('intl', 'sv01', 'sv01-004', 3);
  const set: CatalogSet = {
    ...makeContractPack('intl', 'sv01', []).set,
    languages: ['en', 'fr', 'de'],
    abbreviation: 'SVI',
    cardCount: { total: 258, official: 198 },
  };
  /** The fixture card's English text with `overrides`. */
  const textWith = (overrides: Partial<CatalogCardText>): CatalogCard['text'] => ({
    en: { ...base.text.en, ...overrides } as CatalogCardText,
  });

  function create(card: CatalogCard, language = 'en'): ComponentFixture<CardDetailsComponent> {
    const fixture = TestBed.createComponent(CardDetailsComponent);
    fixture.componentRef.setInput('card', card);
    fixture.componentRef.setInput('set', set);
    fixture.componentRef.setInput('language', language);
    fixture.detectChanges();
    return fixture;
  }

  const element = (fixture: ComponentFixture<CardDetailsComponent>) =>
    fixture.nativeElement as HTMLElement;
  const headers = (fixture: ComponentFixture<CardDetailsComponent>) =>
    [...element(fixture).querySelectorAll('ion-list-header')].map((h) => h.textContent.trim());
  const detail = (fixture: ComponentFixture<CardDetailsComponent>, testId: string) =>
    element(fixture).querySelector(`[data-testid="detail-${testId}"]`)?.textContent.trim();

  /** The collection's storage: the real CollectionService runs on top of it. */
  let stored: Map<string, CollectionEntry>;
  const repository = {
    listCollection: vi.fn(() => Promise.resolve([...stored.values()])),
    setCollectionQuantities: vi.fn((changes: readonly CollectionChange[]) => {
      for (const { target: what, quantity } of changes) {
        if (quantity > 0) {
          stored.set(collectionEntryId(what), collectionEntry(what, quantity));
        } else {
          stored.delete(collectionEntryId(what));
        }
      }
      return Promise.resolve();
    }),
  };
  const entry = (overrides: Partial<CollectionEntry>): CollectionEntry => ({
    region: 'intl',
    cardId: base.id,
    setId: 'sv01',
    variant: 'normal',
    language: 'en',
    quantity: 1,
    ...overrides,
  });
  const rows = (fixture: ComponentFixture<CardDetailsComponent>) =>
    [...element(fixture).querySelectorAll('[data-testid^="variant-"]')].map((row) => ({
      variant: row.getAttribute('data-testid'),
      quantity: row.querySelector('[data-testid="quantity"]')?.textContent.trim(),
    }));
  const button = (fixture: ComponentFixture<CardDetailsComponent>, variant: string, id: string) =>
    element(fixture).querySelector<HTMLIonButtonElement>(
      `[data-testid="variant-${variant}"] [data-testid="${id}"]`
    );
  /** Lets the collection load (native async isn't tracked by zone.js). */
  const settle = async (fixture: ComponentFixture<CardDetailsComponent>) => {
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  };

  /** Stored prices by card ID; bump `version` to signal a sync stored new ones. */
  let storedPrices: Map<string, CatalogCardPrices>;
  const priceService = {
    version: signal(0),
    prices: vi.fn((_region: string, cardId: string) => Promise.resolve(storedPrices.get(cardId))),
  };

  /** Prices show in `currency`, at `rate` per euro, with ECB rates of `ratesDate`. */
  const currency = signal('EUR');
  let rate = 1;
  const currencyService = {
    currency,
    rates: signal<{ date: string } | null>({ date: '2026-11-20' }),
    format: (euros: number) => formatMoney(euros * rate, currency()),
  };

  const modal = { present: vi.fn(() => Promise.resolve()) };
  const modals = { create: vi.fn(() => Promise.resolve(modal)) };
  const wide = signal(false);

  beforeEach(() => {
    modals.create.mockClear();
    wide.set(false);
    currency.set('EUR');
    rate = 1;
    stored = new Map();
    storedPrices = new Map();
    priceService.version.set(0);
    priceService.prices.mockClear();
    repository.setCollectionQuantities.mockClear();
    TestBed.configureTestingModule({
      providers: [
        { provide: LocalUserDataRepository, useValue: repository },
        { provide: SyncService, useValue: { dataChanged$: NEVER } },
        { provide: ImageCacheService, useValue: { resolve: vi.fn(), release: vi.fn() } },
        { provide: VisibilityService, useValue: { whenVisible: () => () => undefined } },
        { provide: CatalogPriceService, useValue: priceService },
        { provide: CurrencyService, useValue: currencyService },
        { provide: ModalController, useValue: modals },
        { provide: LayoutService, useValue: { wide } },
      ],
    });
  });

  it('shows a Pokémon’s name, attacks, stats and details', () => {
    const fixture = create({
      ...base,
      hp: 110,
      stage: 'Stage1',
      illustrator: 'Ken Sugimori',
      attacks: [
        { cost: ['Grass', 'Colorless'], damage: '30' },
        { cost: [], damage: null },
      ],
      text: textWith({
        name: 'Bulbasaur',
        evolveFrom: 'Seed',
        attacks: [
          { name: 'Vine Whip', effect: null },
          { name: 'Growl', effect: 'Flip a coin. {G}' },
        ],
      }),
    });
    const root = element(fixture);

    expect(root.querySelector('h2')?.textContent).toBe('Bulbasaur');
    expect(root.textContent).toContain('HP 110 · Stage 1');
    expect(root.textContent).toContain('Evolves from Seed');
    expect(headers(fixture)).toEqual(['Attacks', 'Collection · English', 'Details']);

    const costs = [...root.querySelectorAll('.cost')];
    expect(costs.map((cost) => cost.getAttribute('aria-label'))).toEqual([
      'Grass, Colorless',
      'No cost',
    ]);
    expect((costs[0] as HTMLElement).style.getPropertyValue('--cost-slots')).toBe('2');
    expect([...root.querySelectorAll('.damage')].map((d) => d.textContent)).toEqual(['30']);
    expect(root.textContent).toContain('Flip a coin.');

    expect(root.querySelector('.stats')?.textContent.replace(/\s+/g, ' ')).toContain(
      'Resistance none'
    );
    expect(detail(fixture, 'set')).toBe('SVI · 004/198');
    expect(detail(fixture, 'rarity')).toBe('Common');
    expect(
      root
        .querySelector('[data-testid="detail-rarity"] [data-testid="rarity-icon"]')
        ?.getAttribute('src')
    ).toBe('assets/rarity/common.png');
    expect(detail(fixture, 'illustrator')).toBe('Ken Sugimori');
    expect(detail(fixture, 'regulation-mark')).toBe('G');
    expect(detail(fixture, 'legal')).toBe('Expanded');
    expect(root.querySelector('app-card-image')).not.toBeNull();
  });

  it('notes when the scan is another printing’s, and only then', () => {
    expect(element(create(base)).querySelector('[data-testid="detail-scan"]')).toBeNull();

    const borrowed = create({ ...base, text: textWith({ imageFrom: 'sve-2' }) });
    expect(element(borrowed).querySelector('[data-testid="detail-scan"]')?.textContent.trim()).toBe(
      'From another printing'
    );
  });

  it('lists abilities', () => {
    const fixture = create({
      ...base,
      text: textWith({
        abilities: [{ type: 'Ability', name: 'Overgrow', effect: 'Heal 10.' }],
      }),
    });

    expect(headers(fixture)).toEqual(['Abilities', 'Attacks', 'Collection · English', 'Details']);
    expect(element(fixture).querySelector('[data-testid="ability-name"]')?.textContent.trim()).toBe(
      'Ability: Overgrow'
    );
  });

  it('shows retreat as Colorless energy icons, or none', () => {
    const retreat = (fixture: ComponentFixture<CardDetailsComponent>) =>
      element(fixture).querySelector('[data-testid="stat-retreat"]');

    const two = retreat(create({ ...base, retreat: 2 }));
    expect(two?.getAttribute('aria-label')).toBe('2 Colorless');
    expect(
      [...(two?.querySelectorAll('app-energy-icon img') ?? [])].map((img) =>
        img.getAttribute('alt')
      )
    ).toEqual(['Colorless', 'Colorless']);

    const none = retreat(create({ ...base, retreat: 0 }));
    expect(none?.getAttribute('aria-label')).toBeNull();
    expect(none?.querySelector('app-energy-icon')).toBeNull();
    expect(none?.textContent.trim()).toBe('none');
  });

  it('puts attack costs inside the label, beside the name', () => {
    const fixture = create({
      ...base,
      attacks: [{ cost: ['Grass'], damage: '10' }],
      text: textWith({ attacks: [{ name: 'Tackle', effect: null }] }),
    });
    const row = element(fixture).querySelector('ion-item ion-label .media-row');

    expect(row?.querySelector('.cost app-energy-icon')).not.toBeNull();
    expect(row?.querySelector('.media-row-text h3')?.textContent).toBe('Tackle');
    expect(element(fixture).querySelector('[slot="start"]')).toBeNull();
  });

  it('shows a Trainer’s effect without Pokémon stats', () => {
    const fixture = create({
      ...base,
      category: 'Trainer',
      trainerType: 'Item',
      types: [],
      attacks: [],
      rarity: null,
      regulationMark: null,
      legal: { standard: false, expanded: false },
      text: textWith({
        attacks: [],
        effect: 'Draw 2 cards.',
        description: 'A handy tool.',
      }),
    });
    const root = element(fixture);

    expect(headers(fixture)).toEqual(['Effect', 'Collection · English', 'Details']);
    expect(root.textContent).toContain('Draw 2 cards.');
    expect(root.querySelector('.stats')).toBeNull();
    expect(root.querySelector('.types')).toBeNull();
    expect(detail(fixture, 'rarity')).toBeUndefined();
    expect(detail(fixture, 'regulation-mark')).toBeUndefined();
    expect(detail(fixture, 'legal')).toBe('Not legal');
    expect(root.querySelector('.hint')?.textContent).toBe('A handy tool.');
  });

  it('lists both formats when legal in Standard', () => {
    const fixture = create({ ...base, legal: { standard: true, expanded: true } });

    expect(detail(fixture, 'legal')).toBe('Standard · Expanded');
  });

  it('uses another language’s text when the language has none', () => {
    const fixture = create(base, 'de');

    expect(element(fixture).querySelector('h2')?.textContent).toBe('sv01-004');
  });

  describe('collection', () => {
    it('lists the card’s variants with the copies owned in the current language', async () => {
      stored.set('intl:sv01-004:reverse:en', entry({ variant: 'reverse', quantity: 2 }));
      stored.set('intl:sv01-004:normal:de', entry({ language: 'de', quantity: 5 }));
      const fixture = create(base);
      await settle(fixture);

      expect(rows(fixture)).toEqual([
        { variant: 'variant-normal', quantity: '0' },
        { variant: 'variant-reverse', quantity: '2' },
      ]);
      expect(button(fixture, 'normal', 'remove-copy')?.disabled).toBe(true);
      expect(button(fixture, 'reverse', 'remove-copy')?.disabled).toBe(false);
    });

    it('offers just Normal when TCGdex lists no variants', () => {
      const fixture = create({
        ...base,
        variants: {
          normal: false,
          reverse: false,
          holo: false,
          firstEdition: false,
          wPromo: false,
        },
      });

      expect(rows(fixture).map((row) => row.variant)).toEqual(['variant-normal']);
    });

    it('adds and removes copies in the current language', async () => {
      const fixture = create(base, 'de');
      await settle(fixture);

      button(fixture, 'reverse', 'add-copy')?.click();
      button(fixture, 'reverse', 'add-copy')?.click();
      await settle(fixture);
      expect(rows(fixture)[1]?.quantity).toBe('2');

      button(fixture, 'reverse', 'remove-copy')?.click();
      await settle(fixture);

      expect(element(fixture).querySelector('[data-testid="collection-header"]')?.textContent).toBe(
        'Collection · German'
      );
      expect(rows(fixture)[1]?.quantity).toBe('1');
      expect(
        repository.setCollectionQuantities.mock.calls.map(([changes]) => changes[0]?.quantity)
      ).toEqual([1, 2, 1]);
      expect([...stored.values()]).toEqual([entry({ variant: 'reverse', language: 'de' })]);
    });

    it('notes copies owned in the set’s other languages, in English and display order', async () => {
      stored.set('intl:sv01-004:normal:de', entry({ language: 'de', quantity: 2 }));
      stored.set('intl:sv01-004:holo:fr', entry({ language: 'fr', variant: 'holo' }));
      stored.set('intl:sv01-004:normal:en', entry({}));
      const fixture = create(base);
      await settle(fixture);

      expect(
        element(fixture).querySelector('[data-testid="other-languages"]')?.textContent.trim()
      ).toBe('Also 2 in German · 1 in French');
    });

    it('keeps the steppers disabled until the collection has loaded', async () => {
      stored.set('intl:sv01-004:normal:en', entry({ quantity: 5 }));
      let finishLoad: () => void = () => undefined;
      repository.listCollection.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishLoad = () => {
              resolve([...stored.values()]);
            };
          })
      );
      const fixture = create(base);

      expect(button(fixture, 'normal', 'add-copy')?.disabled).toBe(true);
      expect(button(fixture, 'reverse', 'add-copy')?.disabled).toBe(true);

      finishLoad();
      await settle(fixture);

      expect(rows(fixture)[0]?.quantity).toBe('5');
      expect(button(fixture, 'normal', 'add-copy')?.disabled).toBe(false);
    });

    it('also lists variants owned that TCGdex doesn’t flag, so they can be changed', async () => {
      stored.set('intl:sv01-004:holo:en', entry({ variant: 'holo', quantity: 1 }));
      const fixture = create(base);
      await settle(fixture);

      expect(rows(fixture)).toEqual([
        { variant: 'variant-normal', quantity: '0' },
        { variant: 'variant-reverse', quantity: '0' },
        { variant: 'variant-holo', quantity: '1' },
      ]);
    });

    it('notes copies in languages the set no longer lists', async () => {
      stored.set('intl:sv01-004:normal:it', entry({ language: 'it', quantity: 3 }));
      const fixture = create(base);
      await settle(fixture);

      expect(
        element(fixture).querySelector('[data-testid="other-languages"]')?.textContent.trim()
      ).toBe('Also 3 in Italian');
    });

    it('logs a change that can’t be saved instead of failing silently', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const fixture = create({ ...base, id: 'x'.repeat(65) });
      await settle(fixture);

      fixture.componentInstance.step('normal', 1);
      await settle(fixture);

      expect(error).toHaveBeenCalledWith('collection.step_failed', expect.any(RangeError));
      expect(repository.setCollectionQuantities).not.toHaveBeenCalled();
      error.mockRestore();
    });

    it('has no other-languages note when only this language is owned', async () => {
      stored.set('intl:sv01-004:normal:en', entry({}));
      const fixture = create(base);
      await settle(fixture);

      expect(element(fixture).querySelector('[data-testid="other-languages"]')).toBeNull();
    });
  });

  describe('prices', () => {
    const prices = (overrides: Partial<CatalogCardPrices> = {}): CatalogCardPrices => ({
      updated: '2026-11-21T05:47:42.306Z',
      idProduct: 483559,
      base: { trend: 0.14, avg7: 0.1, avg30: 0.08 },
      reverseHolo: { trend: 1.5, avg7: null, avg30: 1.25 },
      ...overrides,
    });
    const priceRow = (fixture: ComponentFixture<CardDetailsComponent>, finish: string) => {
      const row = element(fixture).querySelector(`[data-testid="price-${finish}"]`);
      return row
        ? {
            label: row.querySelector('ion-label')?.firstChild?.textContent?.trim(),
            price: row.querySelector('[data-testid="price"]')?.textContent.trim(),
            // Each average line's label and amount cells, joined by a space.
            averages: [...row.querySelectorAll('[data-testid="price-average"]')].map((line) =>
              [...line.children]
                .map((cell) => cell.textContent.replace(/\s+/g, ' ').trim())
                .join(' ')
            ),
          }
        : null;
    };

    it('shows each finish’s Cardmarket price last, after the details', async () => {
      storedPrices.set(base.id, prices());
      const fixture = create(base);
      await settle(fixture);

      expect(priceService.prices).toHaveBeenCalledWith('intl', base.id);
      expect(headers(fixture)).toEqual([
        'Attacks',
        'Collection · English',
        'Details',
        'Price · Cardmarket',
      ]);
      expect(priceRow(fixture, 'base')).toEqual({
        label: 'Normal',
        price: '€0.14',
        averages: ['7-day avg €0.10', '30-day avg €0.08'],
      });
      expect(priceRow(fixture, 'reverseHolo')).toEqual({
        label: 'Reverse holo',
        price: '€1.50',
        averages: ['30-day avg €1.25'],
      });
      expect(
        element(fixture).querySelector('[data-testid="price-updated"]')?.textContent.trim()
      ).toBe('Updated Nov 21, 2026');
    });

    it('links to the card’s Cardmarket offers in its language, opening outside the app', async () => {
      storedPrices.set(base.id, prices());
      const fixture = create(base);
      await settle(fixture);

      const link = element(fixture).querySelector<HTMLIonItemElement>(
        '[data-testid="price-cardmarket"]'
      );
      expect(link?.href).toBe(
        'https://www.cardmarket.com/en/Pokemon/Products?idProduct=483559&language=1'
      );
      expect(link?.target).toBe('_blank');
      expect(link?.rel).toBe('noopener noreferrer');
      expect(link?.detailIcon).toBe('open-outline');
      expect(link?.textContent.trim()).toBe('View on Cardmarket');
    });

    it('links each finish’s row to its offers in the card’s language', async () => {
      storedPrices.set(base.id, prices());
      const fixture = create(base, 'de');
      await settle(fixture);

      const row = (finish: string) =>
        element(fixture).querySelector<HTMLIonItemElement>(`[data-testid="price-${finish}"]`);
      const page = 'https://www.cardmarket.com/en/Pokemon/Products?idProduct=483559';
      expect(row('base')?.href).toBe(`${page}&language=3`);
      expect(row('reverseHolo')?.href).toBe(`${page}&language=3&isReverseHolo=Y`);
      for (const finish of ['base', 'reverseHolo']) {
        expect(row(finish)?.target).toBe('_blank');
        expect(row(finish)?.rel).toBe('noopener noreferrer');
        expect(row(finish)?.detail).toBe(true);
        expect(row(finish)?.detailIcon).toBe('open-outline');
      }
      expect(
        element(fixture).querySelector<HTMLIonItemElement>('[data-testid="price-cardmarket"]')?.href
      ).toBe(`${page}&language=3`);
    });

    it.each([
      ['without a product ID', undefined],
      ['with an invalid product ID', -1],
    ])('has no Cardmarket link %s', async (_label, idProduct) => {
      storedPrices.set(base.id, { ...prices(), idProduct });
      const fixture = create(base);
      await settle(fixture);

      expect(element(fixture).querySelector('[data-testid="price-header"]')).not.toBeNull();
      expect(element(fixture).querySelector('[data-testid="price-cardmarket"]')).toBeNull();
      for (const finish of ['base', 'reverseHolo']) {
        const row = element(fixture).querySelector<HTMLIonItemElement>(
          `[data-testid="price-${finish}"]`
        );
        expect(row?.href).toBeUndefined();
        expect(row?.detail).toBe(false);
      }
    });

    it('shows prices in the currency picked in Settings, noting the conversion', async () => {
      currency.set('CHF');
      rate = 0.9;
      storedPrices.set(base.id, prices());
      const fixture = create(base);
      await settle(fixture);

      expect(priceRow(fixture, 'base')).toEqual({
        label: 'Normal',
        price: 'CHF\u00a00.13',
        averages: ['7-day avg CHF 0.09', '30-day avg CHF 0.07'], // normalized whitespace
      });
      expect(
        element(fixture)
          .querySelector('[data-testid="price-updated"]')
          ?.textContent.replace(/\s+/g, ' ')
          .trim()
      ).toBe('Updated Nov 21, 2026 · converted from euros at the ECB rate of Nov 20, 2026');
    });

    it('falls back to the 30-day average without a trend', async () => {
      storedPrices.set(
        base.id,
        prices({ base: { trend: null, avg7: null, avg30: 2 }, reverseHolo: null })
      );
      const fixture = create(base);
      await settle(fixture);

      expect(priceRow(fixture, 'base')?.price).toBe('€2.00');
      expect(priceRow(fixture, 'reverseHolo')).toBeNull();
    });

    const testId = (fixture: ComponentFixture<CardDetailsComponent>, id: string) =>
      element(fixture).querySelector<HTMLElement>(`[data-testid="${id}"]`);

    it('offers to find a card Cardmarket doesn’t price, in a sheet on phones', async () => {
      const fixture = create(base);
      await settle(fixture);

      expect(headers(fixture)).toContain('Price · Cardmarket');
      expect(testId(fixture, 'price-none')?.textContent.trim()).toBe(
        'No Cardmarket price for this card.'
      );
      testId(fixture, 'price-find')?.click();
      await settle(fixture);

      expect(modals.create).toHaveBeenCalledWith({
        component: CardmarketMatcherComponent,
        componentProps: { cardProp: base, setProp: set, languageProp: 'en' },
        breakpoints: [0, 0.75, 1],
        initialBreakpoint: 1,
        handle: true,
      });
      expect(modal.present).toHaveBeenCalled();
    });

    it('opens the matcher as a dialog on desktop', async () => {
      wide.set(true);
      const fixture = create(base, 'fr');
      await settle(fixture);

      testId(fixture, 'price-find')?.click();
      await settle(fixture);

      expect(modals.create).toHaveBeenCalledWith({
        component: CardmarketMatcherComponent,
        componentProps: { cardProp: base, setProp: set, languageProp: 'fr' },
      });
    });

    it('offers no match for TCG Pocket cards, which Cardmarket never sells', async () => {
      const fixture = TestBed.createComponent(CardDetailsComponent);
      fixture.componentRef.setInput('card', base);
      fixture.componentRef.setInput('set', { ...set, serieId: 'tcgp' });
      fixture.componentRef.setInput('language', 'en');
      fixture.detectChanges();
      await settle(fixture);

      expect(headers(fixture)).not.toContain('Price · Cardmarket');
    });

    it('notes a product matched by hand and offers to change it', async () => {
      storedPrices.set(base.id, prices({ matchedByHand: true }));
      const fixture = create(base);
      await settle(fixture);

      expect(testId(fixture, 'price-updated')?.textContent.replace(/\s+/g, ' ').trim()).toBe(
        'Updated Nov 21, 2026 · product matched by hand'
      );
      expect(testId(fixture, 'price-find')).toBeNull();
      testId(fixture, 'price-change-match')?.click();
      await settle(fixture);
      expect(modals.create).toHaveBeenCalled();
    });

    it('offers no match change for prices TCGdex matched', async () => {
      storedPrices.set(base.id, prices());
      const fixture = create(base);
      await settle(fixture);

      expect(testId(fixture, 'price-change-match')).toBeNull();
      expect(testId(fixture, 'price-find')).toBeNull();
    });

    it('shows new prices when a sync stores them', async () => {
      const fixture = create(base);
      await settle(fixture);
      expect(priceRow(fixture, 'base')).toBeNull();

      storedPrices.set(base.id, prices());
      priceService.version.set(1);
      fixture.detectChanges();
      await settle(fixture);

      expect(priceRow(fixture, 'base')?.price).toBe('€0.14');
    });

    it('shows the new card’s prices, never the previous card’s', async () => {
      storedPrices.set(base.id, prices());
      const fixture = create(base);
      await settle(fixture);

      fixture.componentRef.setInput('card', { ...base, id: 'sv01-005' });
      fixture.detectChanges();

      expect(priceRow(fixture, 'base')).toBeNull();
    });

    it('logs prices that can’t be read and shows none', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      priceService.prices.mockRejectedValueOnce(new Error('disk'));
      const fixture = create(base);
      await settle(fixture);

      expect(error).toHaveBeenCalledWith('catalog.card_prices_failed', expect.any(Error));
      expect(headers(fixture)).not.toContain('Price · Cardmarket');
      error.mockRestore();
    });
  });
});
