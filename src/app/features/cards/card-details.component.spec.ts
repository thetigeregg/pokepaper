import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  collectionEntry,
  collectionEntryId,
  type CatalogCard,
  type CatalogCardText,
  type CatalogSet,
  type CollectionChange,
  type CollectionEntry,
} from '@pokepaper/shared';
import { NEVER } from 'rxjs';
import { vi } from 'vitest';
import { LocalUserDataRepository } from '../../core/data/local-user-data-repository';
import { makeContractCard, makeContractPack } from '../../core/data/storage-engine.contract';
import { ImageCacheService } from '../../core/services/image-cache.service';
import { SyncService } from '../../core/services/sync.service';
import { VisibilityService } from '../../core/services/visibility.service';
import { CardDetailsComponent } from './card-details.component';

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

  beforeEach(() => {
    stored = new Map();
    repository.setCollectionQuantities.mockClear();
    TestBed.configureTestingModule({
      providers: [
        { provide: LocalUserDataRepository, useValue: repository },
        { provide: SyncService, useValue: { dataChanged$: NEVER } },
        { provide: ImageCacheService, useValue: { resolve: vi.fn(), release: vi.fn() } },
        { provide: VisibilityService, useValue: { whenVisible: () => () => undefined } },
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
});
