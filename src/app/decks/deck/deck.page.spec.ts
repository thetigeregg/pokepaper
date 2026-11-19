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
import { DeckChecksService } from '../../features/decks/deck-checks.service';
import { DeckService } from '../../core/services/deck.service';
import type { DeckCheck, NameLimit } from '../../features/decks/deck-rules';
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
    showCopyLimit: vi.fn((_limit: NameLimit) => Promise.resolve()),
  };
  const present = vi.fn(() => Promise.resolve());
  const createModal = vi.fn((_options: Record<string, unknown>) => Promise.resolve({ present }));
  const checks = {
    check: vi.fn((_id: string): DeckCheck | undefined => undefined),
    copyLimit: vi.fn((_id: string, _card: CatalogCard): Promise<NameLimit> =>
      Promise.resolve({ name: 'x', total: 0, limit: 4 })
    ),
  };
  const nav = { navigateBack: vi.fn((_url: string) => Promise.resolve(true)) };
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
        { provide: DeckChecksService, useValue: checks },
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
    expect(missing?.querySelector('[data-testid="open-card"]')).toBeNull();
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

  it('shows no empty state while a deck with cards is still being read', async () => {
    // The deck arrives after the page read the catalog for no cards.
    current.set(undefined);
    await create();
    let finish: (cards: CatalogCard[]) => void = () => undefined;
    engine.getCatalogCardsByKey.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );

    current.set(makeDeck());
    fixture.detectChanges();
    await settle();
    expect(query('[data-testid="deck-empty"]')).toBeNull();
    expect(sectionTitles()).toEqual([]);

    finish([pokemon, trainer, energy]);
    await settle();
    expect(sectionTitles()).toEqual(['Pokémon · 3', 'Trainer · 4', 'Energy · 9']);
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
    await vi.waitFor(() => {
      expect(decks.setCardCount).toHaveBeenCalledTimes(1);
    });
    (row?.querySelector('[data-testid="remove-copy"]') as HTMLElement).click();
    await vi.waitFor(() => {
      expect(decks.setCardCount).toHaveBeenCalledTimes(2);
    });

    expect(checks.copyLimit).toHaveBeenCalledTimes(1); // Only when adding.
    // Each from the deck as it is (the mock doesn't change it): 3 + 1, 3 − 1.
    expect(decks.setCardCount).toHaveBeenNthCalledWith(
      1,
      'deck-1',
      { region: 'intl', cardId: 'sv01-001' },
      4
    );
    expect(decks.setCardCount).toHaveBeenNthCalledWith(
      2,
      'deck-1',
      { region: 'intl', cardId: 'sv01-001' },
      2
    );
  });

  it('adds one copy per tap of +, however fast, and stops at the limit', async () => {
    current.set(makeDeck({ cards: [{ region: 'intl', cardId: 'sv01-001', count: 1 }] }));
    checks.copyLimit.mockImplementation(() =>
      Promise.resolve({ name: 'sv01-001', total: current()?.cards[0]?.count ?? 0, limit: 4 })
    );
    decks.setCardCount.mockImplementation((_id: string, _slot: unknown, count: number) => {
      current.set(makeDeck({ cards: [{ region: 'intl', cardId: 'sv01-001', count }] }));
      return Promise.resolve();
    });
    await create();
    const plus = () => {
      (query('[data-testid="add-copy"]') as HTMLElement).click();
    };

    // Five taps before any of them finishes: 1 → 4, then the limit.
    for (let tap = 0; tap < 5; tap++) {
      plus();
    }
    await vi.waitFor(() => {
      expect(dialogs.showCopyLimit).toHaveBeenCalledTimes(2);
    });

    expect(current()?.cards[0]?.count).toBe(4);
    checks.copyLimit.mockReset();
    checks.copyLimit.mockResolvedValue({ name: 'x', total: 0, limit: 4 });
    decks.setCardCount.mockReset();
    decks.setCardCount.mockResolvedValue(undefined);
  });

  it('removes one copy per tap of −, however fast', async () => {
    current.set(makeDeck({ cards: [{ region: 'intl', cardId: 'sv01-001', count: 3 }] }));
    decks.setCardCount.mockImplementation((_id: string, _slot: unknown, count: number) => {
      current.set(
        makeDeck({ cards: count ? [{ region: 'intl', cardId: 'sv01-001', count }] : [] })
      );
      return Promise.resolve();
    });
    await create();
    const minus = query('[data-testid="remove-copy"]') as HTMLElement;

    minus.click();
    minus.click();
    await settle();

    expect(current()?.cards[0]?.count).toBe(1);
    decks.setCardCount.mockReset();
    decks.setCardCount.mockResolvedValue(undefined);
  });

  it('reports a step that fails before saving (the limit check)', async () => {
    const error = new Error('broken');
    checks.copyLimit.mockRejectedValueOnce(error);
    const page = await create();

    await page.step(page.sections()[0].rows[0], 1);

    expect(decks.setCardCount).not.toHaveBeenCalled();
    expect(dialogs.showSaveError).toHaveBeenCalledWith(error);
    // Later steps still run.
    await page.step(page.sections()[0].rows[0], 1);
    expect(decks.setCardCount).toHaveBeenCalledTimes(1);
  });

  it('adds nothing once the deck holds 4 with the name, saying so', async () => {
    const limit = { name: 'sv01-001', total: 4, limit: 4 };
    checks.copyLimit.mockResolvedValueOnce(limit);
    const page = await create();

    await page.step(page.sections()[0].rows[0], 1);

    expect(checks.copyLimit).toHaveBeenCalledWith('deck-1', pokemon);
    expect(decks.setCardCount).not.toHaveBeenCalled();
    expect(dialogs.showCopyLimit).toHaveBeenCalledWith(limit);
  });

  it('shows the rules section, notes on problem cards, and disables + at the name limit', async () => {
    const check: DeckCheck = {
      format: 'standard',
      issues: [
        { id: 'size', text: '16 of 60 cards' },
        { id: 'legal', text: '3 cards not legal in Standard' },
      ],
      cardNotes: new Map([['intl:sv01-001', ['Not legal in Standard']]]),
      limits: new Map([
        ['intl:sv01-001', { name: 'sv01-001', total: 4, limit: 4 }],
        ['intl:sv01-166', { name: 'sv01-166', total: 4, limit: 4 }],
        ['intl:sv01-258', { name: 'sv01-258', total: 9, limit: 99 }],
      ]),
    };
    checks.check.mockImplementation((id) => (id === 'deck-1' ? check : undefined));
    await create();

    expect(root().textContent).toContain('Standard rules');
    expect(
      [...root().querySelectorAll('[data-testid="deck-rules"] ion-item')].map((item) =>
        item.textContent.trim()
      )
    ).toEqual(['16 of 60 cards', '3 cards not legal in Standard']);
    expect(
      query('[data-testid="deck-card-intl:sv01-001"] [data-testid="rule-note"]')?.textContent.trim()
    ).toBe('Not legal in Standard');
    const plus = (key: string) =>
      (query(`[data-testid="deck-card-${key}"] [data-testid="add-copy"]`) as HTMLIonButtonElement)
        .disabled;
    expect(plus('intl:sv01-166')).toBe(true);
    expect(plus('intl:sv01-258')).toBe(false);
    checks.check.mockReset();
    checks.check.mockReturnValue(undefined);
  });

  it('says the deck follows its rules when nothing is broken, and shows nothing until checked', async () => {
    await create();
    expect(query('[data-testid="deck-rules"]')).toBeNull();

    checks.check.mockReturnValue({
      format: 'expanded',
      issues: [],
      cardNotes: new Map(),
      limits: new Map(),
    });
    current.set(makeDeck({ format: 'expanded' }));
    await create();

    expect(query('[data-testid="rules-ok"]')?.textContent.trim()).toBe('Follows Expanded rules');
    checks.check.mockReturnValue(undefined);
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

    await page.step(page.sections()[0].rows[0], 1);

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

  it('shows an unknown format as Unlimited, and saves Unlimited when picked', async () => {
    current.set(makeDeck({ format: 'glc' }));
    const page = await create();

    expect(page.format()).toBe('unlimited');
    await page.pickFormat('unlimited');
    expect(decks.update).toHaveBeenCalledWith('deck-1', { format: 'unlimited' });
  });

  it('renames the deck, or leaves it when renaming is canceled', async () => {
    const page = await create();

    await page.rename();
    expect(decks.update).toHaveBeenCalledWith('deck-1', { name: 'Zard' });

    dialogs.askRename.mockResolvedValueOnce(null);
    await page.rename();
    expect(decks.update).toHaveBeenCalledTimes(1);
  });

  it('deletes the deck after confirming, once back on the list', async () => {
    let arrive: (done: boolean) => void = () => undefined;
    nav.navigateBack.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          arrive = resolve;
        })
    );
    const page = await create();

    const deleting = page.delete();
    await settle();
    expect(nav.navigateBack).toHaveBeenCalledWith('/tabs/decks');
    expect(decks.remove).not.toHaveBeenCalled();
    current.set(undefined); // Even if it goes meanwhile (a sync), no "isn't on this device".
    fixture.detectChanges();
    expect(query('[data-testid="deck-missing"]')).toBeNull();

    arrive(true);
    await deleting;
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
      query('[data-testid="deck-card-intl:sv01-166"] [data-testid="open-card"]') as HTMLElement
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

  it('opens a card from anywhere on its scan, name and number, or by keyboard', async () => {
    await create();
    const area = query(
      '[data-testid="deck-card-intl:sv01-001"] [data-testid="open-card"]'
    ) as HTMLElement;
    expect(area.getAttribute('role')).toBe('button');
    expect(area.getAttribute('tabindex')).toBe('0');
    expect(area.getAttribute('aria-label')).toBe('Show sv01-001');

    (area.querySelector('.media-row-text') as HTMLElement).click();
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    const space = new KeyboardEvent('keydown', { key: ' ', cancelable: true });
    area.dispatchEvent(space);
    await settle();

    expect(createModal).toHaveBeenCalledTimes(3);
    expect(space.defaultPrevented).toBe(true); // Doesn't scroll the page.
    expect(
      (createModal.mock.lastCall?.[0] as { componentProps: { startIndex: number } }).componentProps
        .startIndex
    ).toBe(0);
  });

  it('opens nothing from the stepper', async () => {
    await create();

    (query('[data-testid="add-copy"]') as HTMLElement).click();
    await settle();

    expect(createModal).not.toHaveBeenCalled();
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

  it('keeps what it read when a read fails, listing the rest by ID with Try again', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await create();
    engine.getCatalogCardsByKey.mockRejectedValueOnce(new Error('broken'));

    current.set(
      makeDeck({ cards: [...makeDeck().cards, { region: 'intl', cardId: 'sv01-300', count: 1 }] })
    );
    fixture.detectChanges();
    await settle();

    expect(error).toHaveBeenCalledWith('deck.cards_load_failed', expect.any(Error));
    expect(sectionTitles()).toEqual([
      'Pokémon · 3',
      'Trainer · 4',
      'Energy · 9',
      "Couldn't be read · 1",
    ]);
    // Still editable.
    expect(
      query('[data-testid="deck-card-intl:sv01-300"] [data-testid="add-copy"]')
    ).not.toBeNull();
    expect(query('[data-testid="cards-read-failed"]')).not.toBeNull();

    (query('[data-testid="cards-retry"]') as HTMLElement).click();
    await settle();

    expect(sectionTitles()).toEqual(['Pokémon · 3', 'Trainer · 4', 'Energy · 9', 'Other · 1']);
    expect(query('[data-testid="cards-read-failed"]')).toBeNull();
    error.mockRestore();
  });

  it('lists every card by ID when the first read fails, rather than a blank page', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    engine.getCatalogCardsByKey.mockRejectedValueOnce(new Error('broken'));

    await create();

    expect(sectionTitles()).toEqual(["Couldn't be read · 16"]);
    expect(query('[data-testid="cards-retry"]')).not.toBeNull();
    error.mockRestore();
  });

  it('ignores a failed read superseded by a newer one', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await create();
    let failSlow: (reason: Error) => void = () => undefined;
    engine.getCatalogCardsByKey.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failSlow = reject;
        })
    );

    current.set(makeDeck({ cards: [{ region: 'intl', cardId: 'sv01-300', count: 1 }] }));
    fixture.detectChanges();
    current.set(makeDeck({ cards: [{ region: 'intl', cardId: 'sv01-258', count: 1 }] }));
    fixture.detectChanges();
    await settle();
    failSlow(new Error('late'));
    await settle();

    expect(fixture.componentInstance.readFailed()).toBe(false);
    expect(sectionTitles()).toEqual(['Energy · 1']);
    error.mockRestore();
  });
});
