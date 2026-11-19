import { computed, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { NavController } from '@ionic/angular';
import type { Deck } from '@pokepaper/shared';
import { vi } from 'vitest';
import { DeckChecksService } from '../features/decks/deck-checks.service';
import { DeckService } from '../core/services/deck.service';
import type { DeckOwned } from '../features/decks/deck-owned';
import type { DeckCheck } from '../features/decks/deck-rules';
import { DeckDialogsService } from '../features/decks/deck-dialogs.service';
import { DecksPage } from './decks.page';

const deck = (id: string, name: string, overrides: Partial<Deck> = {}): Deck => ({
  id,
  name,
  format: 'standard',
  cards: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('DecksPage', () => {
  const list = signal<Deck[]>([]);
  const decks = {
    loaded: signal(true),
    decks: computed(() => list()),
    create: vi.fn((name: string) => Promise.resolve(deck('new-deck', name))),
  };
  const dialogs = {
    askNewName: vi.fn(() => Promise.resolve<string | null>('Lugia VSTAR')),
    showSaveError: vi.fn(() => Promise.resolve()),
  };
  const nav = { navigateForward: vi.fn() };
  const checked = signal<Record<string, DeckCheck>>({});
  const owned = signal<Record<string, DeckOwned>>({});
  const checks = {
    check: (id: string): DeckCheck | undefined => checked()[id],
    ownedOf: (id: string): DeckOwned | undefined => owned()[id],
  };
  let fixture: ComponentFixture<DecksPage>;

  function create(): DecksPage {
    fixture = TestBed.createComponent(DecksPage);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  const root = () => fixture.nativeElement as HTMLElement;
  const query = (selector: string) => root().querySelector(selector);

  beforeEach(() => {
    vi.clearAllMocks();
    list.set([]);
    checked.set({});
    owned.set({});
    decks.loaded.set(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: DeckService, useValue: decks },
        { provide: DeckDialogsService, useValue: dialogs },
        { provide: DeckChecksService, useValue: checks },
        { provide: NavController, useValue: nav },
      ],
    });
  });

  it('lists decks with their format and card total, opening one when tapped', () => {
    list.set([
      deck('a', 'Charizard ex', { cards: [{ region: 'intl', cardId: 'x', count: 47 }] }),
      deck('b', 'Lugia VSTAR', { format: 'expanded' }),
    ]);
    create();

    expect(query('[data-testid="deck-a"]')?.textContent).toContain('Charizard ex');
    expect(query('[data-testid="deck-a"] .hint')?.textContent.trim()).toBe('Standard · 47 cards');
    expect(query('[data-testid="deck-b"] .hint')?.textContent.trim()).toBe('Expanded · 0 cards');
    expect(query('[data-testid="no-decks"]')).toBeNull();

    (query('[data-testid="deck-b"]') as HTMLElement).click();
    expect(nav.navigateForward).toHaveBeenCalledWith(['/tabs/decks/deck', 'b']);
  });

  it('counts the rules a deck breaks, with a warning icon, once checked', () => {
    list.set([deck('a', 'Charizard ex'), deck('b', 'Lugia VSTAR'), deck('c', 'Unchecked')]);
    const issue = { id: 'size', text: '0 of 60 cards' };
    checked.set({
      a: {
        format: 'standard',
        issues: [issue, { id: 'basic', text: 'x' }],
        cardNotes: new Map(),
        limits: new Map(),
      },
      b: { format: 'standard', issues: [issue], cardNotes: new Map(), limits: new Map() },
    });
    create();

    expect(query('[data-testid="deck-a"] .hint')?.textContent.trim()).toBe(
      'Standard · 0 cards · 2 issues'
    );
    expect(query('[data-testid="deck-b"] .hint')?.textContent.trim()).toBe(
      'Standard · 0 cards · 1 issue'
    );
    expect(query('[data-testid="deck-a"] [data-testid="deck-issues"]')).not.toBeNull();
    expect(query('[data-testid="deck-c"] .hint')?.textContent.trim()).toBe('Standard · 0 cards');
    expect(query('[data-testid="deck-c"] [data-testid="deck-issues"]')).toBeNull();
  });

  it('counts the copies the collection lacks, before the issues', () => {
    list.set([deck('a', 'Charizard ex'), deck('b', 'Covered')]);
    owned.set({
      a: { slots: new Map(), missing: 18 },
      b: { slots: new Map(), missing: 0 },
    });
    checked.set({
      a: {
        format: 'standard',
        issues: [{ id: 'size', text: 'x' }],
        cardNotes: new Map(),
        limits: new Map(),
      },
    });
    create();

    expect(query('[data-testid="deck-a"] .hint')?.textContent.trim()).toBe(
      'Standard · 0 cards · 18 missing · 1 issue'
    );
    expect(query('[data-testid="deck-b"] .hint')?.textContent.trim()).toBe('Standard · 0 cards');
  });

  it('offers a New deck row when there are none', () => {
    create();

    expect(query('[data-testid="no-decks"]')).not.toBeNull();
    expect(query('[data-testid="new-deck-row"]')).not.toBeNull();
  });

  it('shows nothing, and disables New deck, until decks have loaded', () => {
    decks.loaded.set(false);
    create();

    expect(query('[data-testid="no-decks"]')).toBeNull();
    expect((query('[data-testid="new-deck"]') as HTMLIonButtonElement).disabled).toBe(true);
  });

  it('creates a named Standard deck and opens it', async () => {
    const page = create();

    await page.create();

    expect(decks.create).toHaveBeenCalledWith('Lugia VSTAR', 'standard');
    expect(nav.navigateForward).toHaveBeenCalledWith(['/tabs/decks/deck', 'new-deck']);
    expect(page.busy()).toBe(false);
  });

  it('creates nothing when naming is canceled', async () => {
    dialogs.askNewName.mockResolvedValueOnce(null);
    const page = create();

    await page.create();

    expect(decks.create).not.toHaveBeenCalled();
    expect(nav.navigateForward).not.toHaveBeenCalled();
  });

  it('says so when the new deck can’t be saved, opening nothing', async () => {
    decks.create.mockRejectedValueOnce(new Error('disk full'));
    const page = create();

    await page.create();

    expect(dialogs.showSaveError).toHaveBeenCalled();
    expect(nav.navigateForward).not.toHaveBeenCalled();
    expect(page.busy()).toBe(false);
  });
});
