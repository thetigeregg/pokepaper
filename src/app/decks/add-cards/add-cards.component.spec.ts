import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ModalController, type IonSearchbar } from '@ionic/angular';
import type { CatalogCard, Deck } from '@pokepaper/shared';
import { vi } from 'vitest';
import { makeContractCard } from '../../core/data/storage-engine.contract';
import { CatalogBrowseService } from '../../core/services/catalog-browse.service';
import { CatalogLanguageService } from '../../core/services/catalog-language.service';
import { CatalogSearchIndexService } from '../../core/services/catalog-search-index.service';
import { CatalogSearchService } from '../../core/services/catalog-search.service';
import { CollectionService } from '../../core/services/collection.service';
import { DeckChecksService } from '../../core/services/deck-checks.service';
import { DeckFullError, DeckService } from '../../core/services/deck.service';
import type { DeckCheck, NameLimit } from '../../features/decks/deck-rules';
import { LayoutService } from '../../core/services/layout.service';
import { RecentSearchesService } from '../../core/services/recent-searches.service';
import { DeckDialogsService } from '../../features/decks/deck-dialogs.service';
import { AddCardsComponent } from './add-cards.component';

const pineco = makeContractCard('intl', 'sv01', 'sv01-001', 0);
const pikachu = makeContractCard('intl', 'sv01', 'sv01-063', 62);

describe('AddCardsComponent', () => {
  const current = signal<Deck>({
    id: 'deck-1',
    name: 'Charizard ex',
    format: 'standard',
    cards: [{ region: 'intl', cardId: 'sv01-001', count: 2 }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  const decks = {
    loaded: signal(true),
    deck: vi.fn((id: string) => (id === current().id ? current() : undefined)),
    setCardCount: vi.fn(() => Promise.resolve()),
  };
  const checks = {
    check: vi.fn((_id: string): DeckCheck | undefined => undefined),
    copyLimit: vi.fn((_id: string, _card: CatalogCard): Promise<NameLimit> =>
      Promise.resolve({ name: 'x', total: 0, limit: 4 })
    ),
  };
  const dialogs = {
    showSaveError: vi.fn(() => Promise.resolve()),
    showCopyLimit: vi.fn(() => Promise.resolve()),
  };
  const modals = { dismiss: vi.fn(() => Promise.resolve(true)) };
  const recent = { recent: signal<string[]>([]), remember: vi.fn(() => Promise.resolve()) };
  const wide = signal(false);
  let fixture: ComponentFixture<AddCardsComponent>;

  function create(): AddCardsComponent {
    // The template's search components have their own specs; this covers the modal's logic.
    TestBed.overrideComponent(AddCardsComponent, { set: { template: '<div></div>' } });
    fixture = TestBed.createComponent(AddCardsComponent);
    fixture.componentInstance.deckIdProp = 'deck-1';
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    wide.set(false);
    TestBed.configureTestingModule({
      providers: [
        { provide: DeckService, useValue: decks },
        { provide: DeckDialogsService, useValue: dialogs },
        { provide: DeckChecksService, useValue: checks },
        { provide: ModalController, useValue: modals },
        { provide: LayoutService, useValue: { wide } },
        {
          provide: CatalogBrowseService,
          useValue: { region: signal('intl'), language: signal('en'), groups: signal([]) },
        },
        { provide: CatalogLanguageService, useValue: { forSet: () => 'en' } },
        { provide: CollectionService, useValue: { loaded: signal(true), cardTotalByKey: () => 0 } },
        {
          provide: CatalogSearchIndexService,
          useValue: {
            cards: signal([]),
            ready: signal(true),
            failed: signal(false),
            retry: vi.fn(),
          },
        },
        { provide: RecentSearchesService, useValue: recent },
      ],
    });
  });

  it('has a search of its own, apart from the Cards tab’s', () => {
    const modal = create();

    expect(modal.search).toBeInstanceOf(CatalogSearchService);
    expect(modal.search).not.toBe(TestBed.inject(CatalogSearchService));
    expect(fixture.debugElement.injector.get(CatalogSearchService)).toBe(modal.search);
  });

  it('counts the copies of a card in the deck', () => {
    const modal = create();

    expect(modal.picker.count(pineco)).toBe(2);
    expect(modal.picker.count(pikachu)).toBe(0);
  });

  it('adds a copy of a picked card', async () => {
    const modal = create();

    await modal.add(pineco);
    await modal.add(pikachu);

    expect(decks.setCardCount).toHaveBeenNthCalledWith(
      1,
      'deck-1',
      { region: 'intl', cardId: 'sv01-001' },
      3
    );
    expect(decks.setCardCount).toHaveBeenNthCalledWith(
      2,
      'deck-1',
      { region: 'intl', cardId: 'sv01-063' },
      1
    );
  });

  it('adds through the picker the results use', async () => {
    const modal = create();

    modal.picker.pick(pikachu);

    await vi.waitFor(() => {
      expect(decks.setCardCount).toHaveBeenCalledWith(
        'deck-1',
        { region: 'intl', cardId: 'sv01-063' },
        1
      );
    });
  });

  it('closes when its deck is deleted (on another device)', () => {
    create();
    expect(modals.dismiss).not.toHaveBeenCalled();
    const saved = current();

    current.set({ ...saved, id: 'another' });
    fixture.detectChanges();

    expect(modals.dismiss).toHaveBeenCalled();
    current.set(saved);
  });

  it('adds nothing once the deck holds as many as it may, saying so', async () => {
    const limit = { name: 'sv01-001', total: 4, limit: 4 };
    checks.copyLimit.mockResolvedValueOnce(limit);
    const modal = create();

    await modal.add(pineco);

    expect(checks.copyLimit).toHaveBeenCalledWith('deck-1', pineco);
    expect(decks.setCardCount).not.toHaveBeenCalled();
    expect(dialogs.showCopyLimit).toHaveBeenCalledWith(limit);
  });

  it('says why a card wasn’t added', async () => {
    const error = new DeckFullError();
    decks.setCardCount.mockRejectedValueOnce(error);
    const modal = create();

    await modal.add(pikachu);

    expect(dialogs.showSaveError).toHaveBeenCalledWith(error);
  });

  it('searches for what’s typed on Enter, remembers it, and hides the phone keyboard', async () => {
    const modal = create();
    const input = { value: 'pika', blur: vi.fn() };
    const bar = { getInputElement: () => Promise.resolve(input) } as unknown as IonSearchbar;

    await modal.submit(bar);

    expect(modal.search.query()).toBe('pika');
    expect(recent.remember).toHaveBeenCalledWith('pika');
    expect(input.blur).toHaveBeenCalled();

    wide.set(true);
    input.blur.mockClear();
    await modal.submit(bar);
    expect(input.blur).not.toHaveBeenCalled();
  });

  it('closes its own modal on Done, even with another on top', () => {
    const modal = create();
    const ionModal = document.createElement('ion-modal');
    const dismiss = vi.fn(() => Promise.resolve(true));
    ionModal.dismiss = dismiss;
    ionModal.appendChild(fixture.nativeElement as HTMLElement);
    document.body.appendChild(ionModal);

    modal.done();

    expect(dismiss).toHaveBeenCalled();
    expect(modals.dismiss).not.toHaveBeenCalled();
    ionModal.remove();
  });

  it('falls back to the top modal when not inside one', () => {
    create().done();

    expect(modals.dismiss).toHaveBeenCalled();
  });
});
