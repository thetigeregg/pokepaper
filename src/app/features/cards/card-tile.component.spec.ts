import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { vi } from 'vitest';
import { makeContractCard } from '../../core/data/storage-engine.contract';
import { CollectionService } from '../../core/services/collection.service';
import { ImageCacheService } from '../../core/services/image-cache.service';
import { VisibilityService } from '../../core/services/visibility.service';
import { CardTileComponent } from './card-tile.component';

describe('CardTileComponent', () => {
  /** Copies owned per `cardId:language`. */
  const owned = signal<Record<string, number>>({});
  const cardTotal = vi.fn(
    (_region: string, cardId: string, language: string) => owned()[`${cardId}:${language}`] ?? 0
  );

  function create(language = 'en'): ComponentFixture<CardTileComponent> {
    const fixture = TestBed.createComponent(CardTileComponent);
    fixture.componentRef.setInput('card', makeContractCard('intl', 'sv01', 'sv01-001', 0));
    fixture.componentRef.setInput('language', language);
    fixture.componentRef.setInput('name', 'Pineco');
    fixture.componentRef.setInput('setLine', 'SVI · 001/198');
    fixture.detectChanges();
    return fixture;
  }

  const element = (fixture: ComponentFixture<CardTileComponent>) =>
    fixture.nativeElement as HTMLElement;
  const badge = (fixture: ComponentFixture<CardTileComponent>) =>
    element(fixture).querySelector('[data-testid="owned-badge"]');

  beforeEach(() => {
    owned.set({});
    TestBed.configureTestingModule({
      providers: [
        { provide: CollectionService, useValue: { cardTotal } },
        { provide: ImageCacheService, useValue: { resolve: vi.fn(), release: vi.fn() } },
        { provide: VisibilityService, useValue: { whenVisible: () => () => undefined } },
      ],
    });
  });

  it('shows no badge for a card that isn’t owned', () => {
    const fixture = create();

    expect(badge(fixture)).toBeNull();
    expect(element(fixture).querySelector('button')?.getAttribute('aria-label')).toBe('Pineco');
    expect(element(fixture).querySelector('.caption')?.textContent).toBe('001 · Pineco');
  });

  it('badges the copies owned in the tile’s language', () => {
    owned.set({ 'sv01-001:en': 1, 'sv01-001:de': 3 });

    const german = create('de');
    expect(badge(german)?.textContent.trim()).toBe('3');
    expect(element(german).querySelector('button')?.getAttribute('aria-label')).toBe(
      'Pineco, 3 owned'
    );
    expect(cardTotal).toHaveBeenLastCalledWith('intl', 'sv01-001', 'de');

    expect(badge(create('fr'))).toBeNull();
  });

  it('updates the badge as the collection changes', () => {
    const fixture = create();

    owned.set({ 'sv01-001:en': 2 });
    fixture.detectChanges();

    expect(badge(fixture)?.textContent.trim()).toBe('2');
  });

  it('opens the card when tapped', () => {
    const fixture = create();
    const opened = vi.fn();
    fixture.componentInstance.opened.subscribe(opened);

    element(fixture).querySelector('button')?.click();

    expect(opened).toHaveBeenCalled();
  });

  describe('adding to a deck', () => {
    function createAdding(inDeck: number): ComponentFixture<CardTileComponent> {
      const fixture = TestBed.createComponent(CardTileComponent);
      fixture.componentRef.setInput('card', makeContractCard('intl', 'sv01', 'sv01-001', 0));
      fixture.componentRef.setInput('language', 'en');
      fixture.componentRef.setInput('name', 'Pineco');
      fixture.componentRef.setInput('setLine', 'SVI · 001/198');
      fixture.componentRef.setInput('adding', true);
      fixture.componentRef.setInput('inDeck', inDeck);
      fixture.detectChanges();
      return fixture;
    }
    const inDeckBadge = (fixture: ComponentFixture<CardTileComponent>) =>
      element(fixture).querySelector('[data-testid="in-deck-badge"]');

    it('labels the tap as adding, with no deck badge until the deck has the card', () => {
      const fixture = createAdding(0);

      expect(inDeckBadge(fixture)).toBeNull();
      expect(element(fixture).querySelector('button')?.getAttribute('aria-label')).toBe(
        'Add Pineco'
      );
    });

    it('badges the copies in the deck beside the owned badge, and says both', () => {
      owned.set({ 'sv01-001:en': 1 });
      const fixture = createAdding(2);

      expect(inDeckBadge(fixture)?.textContent.trim()).toBe('2');
      expect(badge(fixture)?.textContent.trim()).toBe('1');
      expect(element(fixture).querySelector('button')?.getAttribute('aria-label')).toBe(
        'Add Pineco, 2 in deck, 1 owned'
      );
    });

    it('opens the card from the info button, without the tap that adds', () => {
      const fixture = createAdding(0);
      const opened = vi.fn();
      const info = vi.fn();
      fixture.componentInstance.opened.subscribe(opened);
      fixture.componentInstance.info.subscribe(info);

      const button = element(fixture).querySelector('[data-testid="tile-info"]') as HTMLElement;
      expect(button.getAttribute('aria-label')).toBe('Show Pineco');
      button.click();

      expect(info).toHaveBeenCalled();
      expect(opened).not.toHaveBeenCalled();
    });

    it('has no info button when not adding', () => {
      expect(element(create()).querySelector('[data-testid="tile-info"]')).toBeNull();
    });
  });
});
