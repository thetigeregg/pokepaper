import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { CatalogCard, CatalogCardText, CatalogSet } from '@pokepaper/shared';
import { vi } from 'vitest';
import { makeContractCard, makeContractPack } from '../../core/data/storage-engine.contract';
import { ImageCacheService } from '../../core/services/image-cache.service';
import { VisibilityService } from '../../core/services/visibility.service';
import { CardDetailsComponent } from './card-details.component';

describe('CardDetailsComponent', () => {
  const base = makeContractCard('intl', 'sv01', 'sv01-004', 3);
  const set: CatalogSet = {
    ...makeContractPack('intl', 'sv01', []).set,
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

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
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
    expect(headers(fixture)).toEqual(['Attacks', 'Details']);

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
    expect(detail(fixture, 'illustrator')).toBe('Ken Sugimori');
    expect(detail(fixture, 'regulation-mark')).toBe('G');
    expect(detail(fixture, 'legal')).toBe('Expanded');
    expect(root.querySelector('app-card-image')).not.toBeNull();
  });

  it('lists abilities', () => {
    const fixture = create({
      ...base,
      text: textWith({
        abilities: [{ type: 'Ability', name: 'Overgrow', effect: 'Heal 10.' }],
      }),
    });

    expect(headers(fixture)).toEqual(['Abilities', 'Attacks', 'Details']);
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

    expect(headers(fixture)).toEqual(['Effect', 'Details']);
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
});
