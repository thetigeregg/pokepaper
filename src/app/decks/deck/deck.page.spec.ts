import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ModalController, NavController } from '@ionic/angular';
import type { CatalogCard, CatalogSet, Deck } from '@pokepaper/shared';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { makeContractCard, makeContractPack } from '../../core/data/storage-engine.contract';
import { StorageEngineFactory } from '../../core/data/storage-engine.factory';
import { CatalogLanguageService } from '../../core/services/catalog-language.service';
import { CatalogSyncService } from '../../core/services/catalog-sync.service';
import { DeckService } from '../../core/services/deck.service';
import { ImageCacheService } from '../../core/services/image-cache.service';
import { LayoutService } from '../../core/services/layout.service';
import { VisibilityService } from '../../core/services/visibility.service';
import { CardDetailComponent } from '../../features/cards/card-detail.component';
import { DeckDialogsService } from '../../features/decks/deck-dialogs.service';
import { AddCardsComponent } from '../add-cards/add-cards.component';
import { DeckPage } from './deck.page';

const sv01: CatalogSet = {
  ...makeContractPack('intl', 'sv01', []).set,
  abbreviation: 'SVI',
  cardCount: { official: 198, total: 258 },
};
const pokemon = makeContractCard('intl', 'sv01', 'sv01-001', 0);
const trainer: CatalogCard = {
  ...makeContractCard('intl', 'sv01', 'sv01-166', 165),
  category: 'Trainer',
  trainerType: 'Supporter',
};
const energy: CatalogCard = {
  ...makeContractCard('intl', 'sv01', 'sv01-258', 257),
  category: 'Energy',
};
const odd: CatalogCard = {
  ...makeContractCard('intl', 'sv01', 'sv01-300', 299),
  category: 'Mystery',
};

const makeDeck = (overrides: Partial<Deck> = {}): Deck => ({
  id: 'deck-1',
  name: 'Charizard ex',
  format: 'standard',
  cards: [
    { region: 'intl', cardId: 'sv01-166', count: 4 },
    { region: 'intl', cardId: 'sv01-001', count: 3 },
    { region: 'intl', cardId: 'sv01-258', count: 9 },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('DeckPage', () => {
  const stored = new Map<string, CatalogCard>(
    [pokemon, trainer, energy, odd].map((card) => [`intl:${card.id}`, card])
  );
  const engine = {
    getCatalogCardsByKey: vi.fn((keys: readonly string[]) =>
      Promise.resolve(keys.flatMap((key) => stored.get(key) ?? []))
    ),
    getCatalogSet: vi.fn((_region: string, setId: string) =>
      Promise.resolve(
        setId === 'sv01' ? { key: 'intl:sv01', region: 'intl', hash: 'h', set: sv01 } : undefined
      )
    ),
  };
  const current = signal<Deck | undefined>(undefined);
  const decks = {
    loaded: signal(true),
    deck: vi.fn((id: string) => (current()?.id === id ? current() : undefined)),
    setCardCount: vi.fn(() => Promise.resolve()),
    update: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
  };
  const dialogs = {
    askRename: vi.fn(() => Promise.resolve<string | null>('Zard')),
    confirmDelete: vi.fn(() => Promise.resolve(true)),
    showSaveError: vi.fn(() => Promise.resolve()),
  };
  const present = vi.fn(() => Promise.resolve());
  const createModal = vi.fn((_options: Record<string, unknown>) => Promise.resolve({ present }));
  const nav = { navigateBack: vi.fn() };
  const changed = new Subject<void>();
  const wide = signal(false);
  let fixture: ComponentFixture<DeckPage>;

  async function create(id = 'deck-1'): Promise<DeckPage> {
    fixture = TestBed.createComponent(DeckPage);
    fixture.componentRef.setInput('id', id);
    fixture.detectChanges();
    await settle();
    return fixture.componentInstance;
  }

  /** Lets catalog reads (native async/await, which Zone.js can't track) finish, then renders. */
  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }

  const root = () => fixture.nativeElement as HTMLElement;
  const query = (selector: string) => root().querySelector(selector);
  const sectionTitles = () =>
    fixture.componentInstance
      .sections()
      .map((section) => `${section.title} · ${String(section.count)}`);

  beforeEach(() => {
    vi.clearAllMocks();
    current.set(makeDeck());
    decks.loaded.set(true);
    wide.set(false);
    TestBed.configureTestingModule({
      providers: [
        { provide: DeckService, useValue: decks },
        { provide: DeckDialogsService, useValue: dialogs },
        { provide: StorageEngineFactory, useValue: { getEngine: () => engine } },
        { provide: CatalogLanguageService, useValue: { forSet: () => 'en' } },
        { provide: CatalogSyncService, useValue: { changed$: changed.asObservable() } },
        { provide: ModalController, useValue: { create: createModal } },
        { provide: NavController, useValue: nav },
        { provide: LayoutService, useValue: { wide } },
        {
          provide: ImageCacheService,
          useValue: { resolve: vi.fn(() => Promise.resolve(null)), release: vi.fn() },
        },
        { provide: VisibilityService, useValue: { whenVisible: () => () => undefined } },
      ],
    });
  });

  it('shows the format and card total, then the cards by category in the order added', async () => {
    await create();

    expect(query('[data-testid="deck-title"]')?.textContent.trim()).toBe('Charizard ex');
    expect(query('[data-testid="deck-total"]')?.textContent.trim()).toBe('16');
    expect(sectionTitles()).toEqual(['Pokémon · 3', 'Trainer · 4', 'Energy · 9']);
    const row = query('[data-testid="deck-card-intl:sv01-001"]');
    expect(row?.textContent).toContain('sv01-001');
    expect(row?.querySelector('.hint')?.textContent.trim()).toBe('SVI · 001/198');
    expect(row?.querySelector('[data-testid="count"]')?.textContent.trim()).toBe('3');
  });

  it('lists cards not on this device by ID, and other categories apart', async () => {
    current.set(
      makeDeck({
        cards: [
          { region: 'intl', cardId: 'gone-1', count: 1 },
          { region: 'intl', cardId: 'sv01-300', count: 2 },
        ],
      })
    );
    await create();

    expect(sectionTitles()).toEqual(['Other · 2', 'Not on this device · 1']);
    const missing = query('[data-testid="deck-card-intl:gone-1"]');
    expect(missing?.textContent).toContain('gone-1');
    expect(missing?.querySelector('[data-testid="open-thumb"]')).toBeNull();
  });

  it('offers Add cards for an empty deck', async () => {
    current.set(makeDeck({ cards: [] }));
    await create();

    expect(query('[data-testid="deck-empty"]')).not.toBeNull();
    (query('[data-testid="add-cards-row"]') as HTMLElement).click();
    await settle();

    expect(createModal).toHaveBeenCalledWith({
      component: AddCardsComponent,
      componentProps: { deckIdProp: 'deck-1' },
      cssClass: 'add-cards-modal',
    });
    expect(present).toHaveBeenCalled();
  });

  it('says when the deck isn’t on this device', async () => {
    await create('another');

    expect(query('[data-testid="deck-missing"]')).not.toBeNull();
    expect(query('[data-testid="add-cards"]')).toBeNull();
  });

  it('steps a card’s count up and down', async () => {
    await create();
    const row = query('[data-testid="deck-card-intl:sv01-001"]');

    (row?.querySelector('[data-testid="add-copy"]') as HTMLElement).click();
    (row?.querySelector('[data-testid="remove-copy"]') as HTMLElement).click();

    expect(decks.setCardCount).toHaveBeenNthCalledWith(
      1,
      'deck-1',
      { region: 'intl', cardId: 'sv01-001', count: 3 },
      4
    );
    expect(decks.setCardCount).toHaveBeenNthCalledWith(
      2,
      'deck-1',
      { region: 'intl', cardId: 'sv01-001', count: 3 },
      2
    );
  });

  it('disables adding past the most copies a slot holds', async () => {
    current.set(makeDeck({ cards: [{ region: 'intl', cardId: 'sv01-001', count: 99 }] }));
    await create();

    const add = query('[data-testid="add-copy"]') as HTMLIonButtonElement;
    expect(add.disabled).toBe(true);
  });

  it('says so when a change can’t be saved', async () => {
    const error = new Error('disk full');
    decks.setCardCount.mockRejectedValueOnce(error);
    const page = await create();

    await page.setCount(page.sections()[0].rows[0], 4);

    expect(dialogs.showSaveError).toHaveBeenCalledWith(error);
  });

  it('changes the format, skipping the current one and unknown values', async () => {
    const page = await create();

    await page.pickFormat('standard');
    await page.pickFormat('glc');
    await page.pickFormat('expanded');

    expect(decks.update).toHaveBeenCalledTimes(1);
    expect(decks.update).toHaveBeenCalledWith('deck-1', { format: 'expanded' });
  });

  it('shows an unknown format as Unlimited', async () => {
    current.set(makeDeck({ format: 'glc' }));
    const page = await create();

    expect(page.format()).toBe('unlimited');
  });

  it('renames the deck, or leaves it when renaming is cancelled', async () => {
    const page = await create();

    await page.rename();
    expect(decks.update).toHaveBeenCalledWith('deck-1', { name: 'Zard' });

    dialogs.askRename.mockResolvedValueOnce(null);
    await page.rename();
    expect(decks.update).toHaveBeenCalledTimes(1);
  });

  it('deletes the deck after confirming, going back to the list', async () => {
    const page = await create();

    await page.delete();

    expect(nav.navigateBack).toHaveBeenCalledWith('/tabs/decks');
    expect(decks.remove).toHaveBeenCalledWith('deck-1');
  });

  it('keeps the deck when the delete isn’t confirmed', async () => {
    dialogs.confirmDelete.mockResolvedValueOnce(false);
    const page = await create();

    await page.delete();

    expect(decks.remove).not.toHaveBeenCalled();
    expect(nav.navigateBack).not.toHaveBeenCalled();
  });

  it.each([
    ['renaming', (page: DeckPage) => page.rename(), () => decks.update],
    ['changing the format', (page: DeckPage) => page.pickFormat('expanded'), () => decks.update],
    ['deleting', (page: DeckPage) => page.delete(), () => decks.remove],
  ])('says so when %s fails', async (_label, act, method) => {
    method().mockRejectedValueOnce(new Error('disk full'));
    const page = await create();

    await act(page);

    expect(dialogs.showSaveError).toHaveBeenCalled();
  });

  it('opens a card in the modal, paging through the deck in its listed order', async () => {
    await create();

    (
      query('[data-testid="deck-card-intl:sv01-166"] [data-testid="open-thumb"]') as HTMLElement
    ).click();
    await settle();

    expect(createModal).toHaveBeenCalledWith(
      expect.objectContaining({
        component: CardDetailComponent,
        componentProps: {
          setsProp: new Map([['intl:sv01', sv01]]),
          cardsProp: [pokemon, trainer, energy],
          startIndex: 1,
        },
        breakpoints: [0, 1],
      })
    );
  });

  it('opens cards in a centered dialog on desktop', async () => {
    wide.set(true);
    const page = await create();

    await page.openCard(page.sections()[0].rows[0]);

    expect(createModal.mock.lastCall?.[0]).not.toHaveProperty('breakpoints');
  });

  it('reads cards again when printings are added, and when the catalog updates', async () => {
    await create();
    expect(engine.getCatalogCardsByKey).toHaveBeenCalledTimes(1);

    current.set(
      makeDeck({ cards: [...makeDeck().cards, { region: 'intl', cardId: 'sv01-300', count: 1 }] })
    );
    fixture.detectChanges();
    await settle();
    expect(engine.getCatalogCardsByKey).toHaveBeenCalledTimes(2);
    expect(sectionTitles()).toContain('Other · 1');

    // A count change alone doesn't read the catalog again.
    current.set(makeDeck({ cards: [{ region: 'intl', cardId: 'sv01-166', count: 1 }] }));
    fixture.detectChanges();
    await settle();
    current.set(makeDeck({ cards: [{ region: 'intl', cardId: 'sv01-166', count: 2 }] }));
    fixture.detectChanges();
    await settle();
    expect(engine.getCatalogCardsByKey).toHaveBeenCalledTimes(3);

    vi.useFakeTimers();
    changed.next();
    vi.advanceTimersByTime(300);
    vi.useRealTimers();
    await settle();
    expect(engine.getCatalogCardsByKey).toHaveBeenCalledTimes(4);
  });

  it('runs Rename and Delete from the header actions, disabled without a deck', async () => {
    const page = await create();
    const [rename, remove] = page.actions();

    rename.run();
    remove.run();
    await settle();

    expect(dialogs.askRename).toHaveBeenCalled();
    expect(dialogs.confirmDelete).toHaveBeenCalled();
    current.set(undefined);
    expect(page.actions().every((action) => action.disabled)).toBe(true);
  });

  it('does nothing for a deck that isn’t here', async () => {
    const page = await create('another');

    expect(page.format()).toBe('standard');
    expect(page.total()).toBe(0);
    expect(page.sections()).toEqual([]);
    await page.rename();
    await page.delete();
    expect(dialogs.askRename).not.toHaveBeenCalled();
    expect(dialogs.confirmDelete).not.toHaveBeenCalled();
  });

  it('names a card by ID when its set isn’t stored, and a card from an unknown catalog', async () => {
    const loose = makeContractCard('intl', 'gone', 'gone-007', 6);
    stored.set('intl:gone-007', loose);
    current.set(
      makeDeck({
        cards: [
          { region: 'intl', cardId: 'gone-007', count: 1 },
          { region: 'moon', cardId: 'm-1', count: 1 },
        ],
      })
    );
    const page = await create();

    const [pokemonSection, missingSection] = page.sections();
    expect(pokemonSection.rows[0]).toMatchObject({ name: 'gone-007', line: 'gone-007' });
    expect(missingSection.rows[0]).toMatchObject({ name: 'm-1', language: 'en' });
    stored.delete('intl:gone-007');
  });

  it('opens nothing for a card not on this device', async () => {
    current.set(makeDeck({ cards: [{ region: 'intl', cardId: 'gone-1', count: 1 }] }));
    const page = await create();

    await page.openCard(page.sections()[0].rows[0]);

    expect(createModal).not.toHaveBeenCalled();
  });

  it('drops a catalog read that finishes after a newer one', async () => {
    await create();
    let finishSlow: (cards: CatalogCard[]) => void = () => undefined;
    engine.getCatalogCardsByKey.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSlow = resolve;
        })
    );

    // Slow read for the first change, then a quick one for the next.
    current.set(makeDeck({ cards: [{ region: 'intl', cardId: 'sv01-300', count: 1 }] }));
    fixture.detectChanges();
    current.set(makeDeck({ cards: [{ region: 'intl', cardId: 'sv01-258', count: 1 }] }));
    fixture.detectChanges();
    await settle();
    finishSlow([odd]);
    await settle();

    expect(sectionTitles()).toEqual(['Energy · 1']);
  });

  it('keeps what it shows when reading the catalog fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await create();
    engine.getCatalogCardsByKey.mockRejectedValueOnce(new Error('broken'));

    current.set(
      makeDeck({ cards: [...makeDeck().cards, { region: 'intl', cardId: 'sv01-300', count: 1 }] })
    );
    fixture.detectChanges();
    await settle();

    expect(error).toHaveBeenCalledWith('deck.cards_load_failed', expect.any(Error));
    expect(sectionTitles()).toEqual(['Pokémon · 3', 'Trainer · 4', 'Energy · 9']);
    error.mockRestore();
  });
});
