import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { AlertController } from '@ionic/angular';
import {
  collectionEntryId,
  type CatalogCard,
  type CollectionChange,
  type CollectionTarget,
} from '@pokepaper/shared';
import { vi } from 'vitest';
import { makeContractCard, makeContractPack } from '../../core/data/storage-engine.contract';
import { CollectionService } from '../../core/services/collection.service';
import { ImageCacheService } from '../../core/services/image-cache.service';
import { VisibilityService } from '../../core/services/visibility.service';
import { SetChecklistComponent } from './set-checklist.component';

describe('SetChecklistComponent', () => {
  const set = {
    ...makeContractPack('intl', 'sv01', []).set,
    cardCount: { total: 3, official: 3 },
  };
  const card = (id: string, index: number, overrides: Partial<CatalogCard> = {}): CatalogCard => ({
    ...makeContractCard('intl', 'sv01', id, index),
    ...overrides,
  });
  /** Normal + Reverse (the contract card's flags), a Holo-only rare, a card without flags. */
  const cards = [
    card('sv01-001', 0),
    card('sv01-002', 1, {
      rarity: 'Rare',
      variants: { normal: false, reverse: false, holo: true, firstEdition: false, wPromo: false },
    }),
    card('sv01-003', 2, {
      rarity: null,
      variants: { normal: false, reverse: false, holo: false, firstEdition: false, wPromo: false },
    }),
  ];

  /** Copies by collection entry ID. */
  const owned = signal<Record<string, number>>({});
  const loaded = signal(true);
  const collection = {
    loaded,
    quantity: (target: CollectionTarget) => owned()[collectionEntryId(target)] ?? 0,
    cardTotal: (_region: string, cardId: string, language: string) =>
      Object.entries(owned())
        .filter(([id]) => id.startsWith(`intl:${cardId}:`) && id.endsWith(`:${language}`))
        .reduce((total, [, quantity]) => total + quantity, 0),
    variantsOwned: (_region: string, cardId: string, language: string) =>
      Object.entries(owned())
        .filter(([id, quantity]) => quantity > 0 && id.startsWith(`intl:${cardId}:`))
        .map(([id]) => id.split(':'))
        .filter((parts) => parts[3] === language)
        .map((parts) => parts[2] ?? ''),
    ownedInSet: vi.fn(() => 1),
    setQuantity: vi.fn((target: CollectionTarget, quantity: number) => {
      owned.update((current) => ({ ...current, [collectionEntryId(target)]: quantity }));
      return Promise.resolve();
    }),
    setQuantities: vi.fn((_changes: readonly CollectionChange[]) => Promise.resolve()),
  };
  let role = 'confirm';
  const alert = {
    present: vi.fn(() => Promise.resolve()),
    onDidDismiss: vi.fn(() => Promise.resolve({ role })),
  };
  const alerts = { create: vi.fn((_options: { message: string }) => Promise.resolve(alert)) };

  let fixture: ComponentFixture<SetChecklistComponent>;

  function create(language = 'en'): SetChecklistComponent {
    fixture = TestBed.createComponent(SetChecklistComponent);
    fixture.componentRef.setInput('cards', cards);
    fixture.componentRef.setInput('set', set);
    fixture.componentRef.setInput('language', language);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  const root = () => fixture.nativeElement as HTMLElement;
  const chip = (cardId: string, variant: string) =>
    root().querySelector<HTMLIonButtonElement>(
      `[data-testid="checklist-${cardId}"] [data-testid="toggle-${variant}"]`
    );

  beforeEach(() => {
    vi.clearAllMocks();
    owned.set({});
    loaded.set(true);
    role = 'confirm';
    TestBed.configureTestingModule({
      providers: [
        { provide: CollectionService, useValue: collection },
        { provide: AlertController, useValue: alerts },
        {
          provide: ImageCacheService,
          useValue: { resolve: vi.fn(() => Promise.resolve(null)), release: vi.fn() },
        },
        { provide: VisibilityService, useValue: { whenVisible: () => () => undefined } },
      ],
    });
  });

  it('adds reverse holo toggles for cards that can come in one in a set without flags', () => {
    // As in BREAKthrough: no card flagged reverse holo.
    const unflagged = {
      normal: true,
      reverse: false,
      holo: false,
      firstEdition: false,
      wPromo: false,
    };
    const checklist = create();
    fixture.componentRef.setInput('cards', [
      card('sv01-001', 0, { variants: unflagged }),
      card('sv01-002', 1, {
        rarity: 'Rare',
        variants: unflagged,
        tcgplayerFinishes: { normal: false, holo: true, reverse: false, firstEdition: false },
      }),
    ]);
    fixture.detectChanges();

    expect(checklist.rows().map((row) => row.variants.map((v) => v.variant))).toEqual([
      ['normal', 'reverse'], // A plain common.
      ['holo'], // TCGplayer sells it as a holo only, and no card of the set in reverse holo.
    ]);
  });

  it('lists each card with its scan, number and name, rarity, then a toggle per variant', () => {
    owned.set({ 'intl:sv01-001:reverse:en': 2 });
    const checklist = create();

    expect(
      checklist
        .rows()
        .map((row) => [row.card.localId, row.name, row.variants.map((v) => v.variant)])
    ).toEqual([
      ['001', 'sv01-001', ['normal', 'reverse']],
      ['002', 'sv01-002', ['holo']],
      ['003', 'sv01-003', ['normal']], // No flags: just Normal.
    ]);
    const first = root().querySelector('[data-testid="checklist-sv01-001"]');
    expect(first?.querySelector('[data-testid="open-thumb"] app-card-image')).not.toBeNull();
    const text = first?.querySelector('.media-row-text');
    expect(text?.textContent).toContain('001 · sv01-001');
    expect(text?.querySelector('p')?.textContent.trim()).toBe('Common');
    expect(text?.querySelector('p [data-testid="rarity-icon"]')?.getAttribute('src')).toBe(
      'assets/rarity/common.png'
    );
    expect(text?.querySelectorAll('.variants [data-testid^="toggle-"]')).toHaveLength(2);
    const reverse = chip('sv01-001', 'reverse');
    expect(reverse?.fill).toBe('solid');
    expect(reverse?.textContent.replace(/\s+/g, ' ').trim()).toBe('Reverse holo ×2');
    const [row] = checklist.rows();
    expect(checklist.variantLabel(row, row.variants[1])).toBe('sv01-001 Reverse holo, 2 copies');
    const normal = chip('sv01-001', 'normal');
    expect(normal?.fill).toBe('outline');
    expect(normal?.textContent.trim()).toBe('Normal');
    expect(root().querySelector('[data-testid="checklist-summary"]')?.textContent).toContain(
      '1 / 3 owned'
    );
    expect(collection.ownedInSet).toHaveBeenCalledWith('intl', 'sv01', 'en');
  });

  it('adds a toggle for each stamped version owned, but not the others', () => {
    owned.set({ 'intl:sv01-001:va1:en': 1, 'intl:sv01-001:vb2:de': 1 });
    const checklist = create();
    fixture.componentRef.setInput('cards', [
      card('sv01-001', 0, {
        stamped: [
          { key: 'va1', type: 'normal', stamps: ['staff'] },
          { key: 'vb2', type: 'holo', stamps: ['pre-release'] },
        ],
      }),
    ]);
    fixture.detectChanges();

    expect(checklist.rows()[0]?.variants).toEqual([
      { variant: 'normal', label: 'Normal', quantity: 0 },
      { variant: 'reverse', label: 'Reverse holo', quantity: 0 },
      { variant: 'va1', label: 'Normal · Staff', quantity: 1 },
    ]);

    chip('sv01-001', 'va1')?.click();
    expect(collection.setQuantity).toHaveBeenCalledWith(
      { region: 'intl', cardId: 'sv01-001', setId: 'sv01', variant: 'va1', language: 'en' },
      0
    );
    fixture.detectChanges();

    // Toggled off, it stays, so the tap can be undone; not in another language.
    expect(checklist.rows()[0]?.variants.at(-1)).toEqual({
      variant: 'va1',
      label: 'Normal · Staff',
      quantity: 0,
    });
    chip('sv01-001', 'va1')?.click();
    expect(collection.setQuantity).toHaveBeenLastCalledWith(
      expect.objectContaining({ variant: 'va1' }),
      1
    );
    fixture.componentRef.setInput('language', 'de');
    fixture.detectChanges();
    expect(checklist.rows()[0]?.variants.map((v) => v.variant)).toEqual([
      'normal',
      'reverse',
      'vb2',
    ]);
  });

  it('toggles a variant between 0 and 1 copy in the current language', () => {
    create('de');

    chip('sv01-001', 'normal')?.click();
    expect(collection.setQuantity).toHaveBeenLastCalledWith(
      { region: 'intl', cardId: 'sv01-001', setId: 'sv01', variant: 'normal', language: 'de' },
      1
    );
    fixture.detectChanges();
    expect(chip('sv01-001', 'normal')?.fill).toBe('solid');

    chip('sv01-001', 'normal')?.click();
    expect(collection.setQuantity).toHaveBeenLastCalledWith(
      expect.objectContaining({ variant: 'normal', language: 'de' }),
      0
    );
  });

  it('opens the card from its scan or ⓘ, or from a variant with more than one copy', () => {
    owned.set({ 'intl:sv01-002:holo:en': 3 });
    const checklist = create();
    const opened = vi.fn();
    checklist.opened.subscribe(opened);

    chip('sv01-002', 'holo')?.click();
    root()
      .querySelector<HTMLElement>('[data-testid="checklist-sv01-003"] [data-testid="open-card"]')
      ?.click();
    root()
      .querySelector<HTMLElement>('[data-testid="checklist-sv01-001"] [data-testid="open-thumb"]')
      ?.click();

    expect(opened.mock.calls).toEqual([[1], [2], [0]]);
    expect(collection.setQuantity).not.toHaveBeenCalled();
  });

  it('disables the toggles and Mark all until the collection has loaded', () => {
    loaded.set(false);
    create();

    expect(chip('sv01-001', 'normal')?.disabled).toBe(true);
    expect(root().querySelector<HTMLIonButtonElement>('[data-testid="mark-all"]')?.disabled).toBe(
      true
    );
  });

  it('marks every unowned card owned in its first variant, after confirming', async () => {
    owned.set({ 'intl:sv01-001:reverse:de': 1 });
    const checklist = create('de');

    await checklist.markAll();

    expect(alerts.create.mock.calls[0]?.[0].message).toContain(
      "the 2 cards you don't own yet in German"
    );
    expect(
      collection.setQuantities.mock.calls[0]?.[0].map(({ target, quantity }) => [
        target.cardId,
        target.variant,
        target.language,
        quantity,
      ])
    ).toEqual([
      ['sv01-002', 'holo', 'de', 1],
      ['sv01-003', 'normal', 'de', 1],
    ]);
  });

  it('leaves cards that gained copies while the alert was open', async () => {
    const checklist = create();
    alert.onDidDismiss.mockImplementationOnce(() => {
      owned.set({ 'intl:sv01-002:holo:en': 3 }); // A sync arrives meanwhile.
      return Promise.resolve({ role: 'confirm' });
    });

    await checklist.markAll();

    expect(alerts.create.mock.calls[0]?.[0].message).toContain('the 3 cards');
    expect(collection.setQuantities.mock.calls[0]?.[0].map(({ target }) => target.cardId)).toEqual([
      'sv01-001',
      'sv01-003',
    ]);
  });

  it('marks nothing when cancelled, or when every card is owned', async () => {
    role = 'cancel';
    const checklist = create();
    await checklist.markAll();
    expect(collection.setQuantities).not.toHaveBeenCalled();

    owned.set({
      'intl:sv01-001:normal:en': 1,
      'intl:sv01-002:holo:en': 1,
      'intl:sv01-003:normal:en': 1,
    });
    fixture.detectChanges();
    expect(root().querySelector<HTMLIonButtonElement>('[data-testid="mark-all"]')?.disabled).toBe(
      true
    );
    await checklist.markAll();
    expect(alerts.create).toHaveBeenCalledTimes(1);
  });

  it('logs a toggle or Mark all that fails to save', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    collection.setQuantity.mockImplementationOnce(() => Promise.reject(new Error('nope')));
    collection.setQuantities.mockImplementationOnce(() => Promise.reject(new Error('nope')));
    const checklist = create();

    chip('sv01-001', 'normal')?.click();
    await checklist.markAll();
    await Promise.resolve();

    expect(error).toHaveBeenCalledWith('collection.toggle_failed', expect.any(Error));
    expect(error).toHaveBeenCalledWith('collection.mark_all_failed', expect.any(Error));
    error.mockRestore();
  });
});
