import { HttpErrorResponse } from '@angular/common/http';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ModalController, ToastController } from '@ionic/angular';
import type { CardmarketCandidate, CardmarketCandidates, CatalogSet } from '@pokepaper/shared';
import { vi } from 'vitest';
import { makeContractCard, makeContractPack } from '../../core/data/storage-engine.contract';
import { CardmarketMatchService } from '../../core/services/cardmarket-match.service';
import { CurrencyService, formatMoney } from '../../core/services/currency.service';
import { ImageCacheService } from '../../core/services/image-cache.service';
import { VisibilityService } from '../../core/services/visibility.service';
import { CardmarketMatcherComponent } from './cardmarket-matcher.component';

const card = makeContractCard('intl', 'xy8', 'xy8-63', 62);
const set: CatalogSet = {
  ...makeContractPack('intl', 'xy8', []).set,
  abbreviation: 'BKT',
  cardCount: { total: 164, official: 162 },
};

const product = (
  idProduct: number,
  overrides: Partial<CardmarketCandidate> = {}
): CardmarketCandidate => ({
  idProduct,
  name: 'MMewtwo EX [Vanishing Strike]',
  added: '2015-11-12',
  inSet: true,
  prices: {
    updated: '2026-11-24T01:45:23.000Z',
    idProduct,
    base: { trend: 114.68, avg7: 28.04, avg30: 69.78 },
    reverseHolo: null,
  },
  ...overrides,
});

describe('CardmarketMatcherComponent', () => {
  const matches = {
    candidates: vi.fn<CardmarketMatchService['candidates']>(),
    match: vi.fn(() => Promise.resolve()),
    clear: vi.fn(() => Promise.resolve()),
  };
  const modals = { dismiss: vi.fn(() => Promise.resolve(true)) };
  const toast = { present: vi.fn(() => Promise.resolve()) };
  const toasts = { create: vi.fn(() => Promise.resolve(toast)) };
  let fixture: ComponentFixture<CardmarketMatcherComponent>;

  const answer = (overrides: Partial<CardmarketCandidates> = {}): CardmarketCandidates => ({
    current: null,
    products: [product(286309), product(363682, { added: null, inSet: false, prices: null })],
    truncated: false,
    searched: false,
    ...overrides,
  });

  /** Opens the matcher on `result`, or on a failed load with `{ failure }`. */
  async function create(
    result: CardmarketCandidates | { failure: unknown } = answer()
  ): Promise<void> {
    if ('failure' in result) {
      matches.candidates.mockRejectedValue(result.failure);
    } else {
      matches.candidates.mockResolvedValue(result);
    }
    fixture = TestBed.createComponent(CardmarketMatcherComponent);
    fixture.componentInstance.cardProp = card;
    fixture.componentInstance.setProp = set;
    fixture.componentInstance.languageProp = 'de';
    fixture.detectChanges();
    await settle();
  }

  /** Native async isn't tracked by zone.js. */
  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }

  const query = (testId: string) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  const text = (testId: string) => query(testId)?.textContent.replace(/\s+/g, ' ').trim();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    TestBed.configureTestingModule({
      providers: [
        { provide: CardmarketMatchService, useValue: matches },
        { provide: ModalController, useValue: modals },
        { provide: ToastController, useValue: toasts },
        {
          provide: CurrencyService,
          useValue: { format: (euros: number) => formatMoney(euros, 'EUR') },
        },
        {
          provide: ImageCacheService,
          useValue: { resolve: vi.fn(() => Promise.resolve(null)), release: vi.fn() },
        },
        { provide: VisibilityService, useValue: { whenVisible: () => () => undefined } },
      ],
    });
  });

  it('shows the card and suggests products, with prices and Cardmarket links', async () => {
    await create();

    expect(matches.candidates).toHaveBeenCalledWith('intl', 'xy8-63', '');
    expect(text('matcher-card')).toContain('BKT · 63/162');
    expect(text('candidate-286309')).toContain('This set · added Nov 12, 2015');
    expect(text('candidate-286309')).toContain('€114.68');
    expect(text('candidate-363682')).toContain('Another set');
    expect(query('candidate-363682')?.querySelector('[data-testid="candidate-price"]')).toBeNull();
    expect(
      query('candidate-286309')?.querySelector<HTMLIonButtonElement>(
        '[data-testid="candidate-link"]'
      )?.href
    ).toBe('https://www.cardmarket.com/en/Pokemon/Products?idProduct=286309&language=3');
    expect(query('matcher-current')).toBeNull();
  });

  it('searches as you type, dropping answers to older searches', async () => {
    await create();
    let resolveOld: (value: CardmarketCandidates) => void = () => undefined;
    matches.candidates.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      })
    );
    matches.candidates.mockResolvedValueOnce(answer({ products: [product(1)], searched: true }));
    const searchbar = query('matcher-search');

    searchbar?.dispatchEvent(new CustomEvent('ionInput', { detail: { value: 'MMew' } }));
    searchbar?.dispatchEvent(new CustomEvent('ionInput', { detail: { value: 'MMewtwo' } }));
    await settle();
    resolveOld(answer({ products: [product(2)] }));
    await settle();

    expect(matches.candidates).toHaveBeenLastCalledWith('intl', 'xy8-63', 'MMewtwo');
    expect(query('candidate-1')).not.toBeNull();
    expect(query('candidate-2')).toBeNull();
    expect(text('matcher-results-header')).toBe('Results');
  });

  it('heads suggestions as such when the search was too short to run', async () => {
    await create();
    expect(text('matcher-results-header')).toBe('Suggestions');

    matches.candidates.mockResolvedValueOnce(answer({ searched: false }));
    query('matcher-search')?.dispatchEvent(new CustomEvent('ionInput', { detail: { value: 'M' } }));
    await settle();

    expect(text('matcher-results-header')).toBe('Suggestions');
  });

  it('limits searches to the length the server takes', async () => {
    await create();

    expect(query('matcher-search')?.getAttribute('maxlength')).toBe('100');
  });

  it('shows the reverse holo price when the base finish has no headline price', async () => {
    await create(
      answer({
        products: [
          product(7, {
            prices: {
              updated: '2026-11-24T01:45:23.000Z',
              base: { trend: null, avg7: 0.2, avg30: null },
              reverseHolo: { trend: 0.5, avg7: null, avg30: null },
            },
          }),
        ],
      })
    );

    expect(text('candidate-7')).toContain('€0.50');
  });

  it('matches a product and closes', async () => {
    await create();

    query('candidate-286309')
      ?.querySelector<HTMLElement>('[data-testid="candidate-match"]')
      ?.click();
    await settle();

    expect(matches.match).toHaveBeenCalledWith('intl', 'xy8-63', 286309);
    expect(modals.dismiss).toHaveBeenCalledWith(undefined, 'match');
  });

  it('shows a match made by hand, checked, and removes it', async () => {
    await create(
      answer({
        current: { idProduct: 286309, matchedByHand: true, name: 'MMewtwo EX [Vanishing Strike]' },
      })
    );

    expect(text('matcher-current')).toContain('Matched by hand');
    expect(
      query('candidate-286309')?.querySelector('[data-testid="candidate-matched"]')
    ).not.toBeNull();
    expect(query('candidate-286309')?.querySelector('[data-testid="candidate-match"]')).toBeNull();
    query('matcher-clear')?.click();
    await settle();

    expect(matches.clear).toHaveBeenCalledWith('intl', 'xy8-63');
    expect(modals.dismiss).toHaveBeenCalledWith(undefined, 'clear');
  });

  it('shows TCGdex’s product as the current one, without removing or matching it', async () => {
    await create(answer({ current: { idProduct: 286309, matchedByHand: false, name: null } }));

    expect(text('matcher-current')).toContain('Product 286309');
    expect(text('matcher-current')).toContain('From TCGdex');
    expect(query('matcher-clear')).toBeNull();
    expect(
      query('candidate-286309')?.querySelector('[data-testid="candidate-matched"]')
    ).not.toBeNull();
    expect(query('candidate-286309')?.querySelector('[data-testid="candidate-match"]')).toBeNull();
  });

  it('reports a match it couldn’t save and stays open', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    matches.match.mockRejectedValueOnce(new Error('offline'));
    await create();

    query('candidate-286309')
      ?.querySelector<HTMLElement>('[data-testid="candidate-match"]')
      ?.click();
    await settle();

    expect(toasts.create).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Couldn't save the match. Try again.", color: 'danger' })
    );
    expect(modals.dismiss).not.toHaveBeenCalled();
    expect(fixture.componentInstance.busy()).toBe(false);
    error.mockRestore();
  });

  it('says when nothing was found, or more than it shows', async () => {
    await create(answer({ products: [] }));
    expect(query('matcher-empty')).not.toBeNull();

    await create(answer({ truncated: true }));
    expect(text('matcher-truncated')).toBe('Showing the first 50. Search to narrow them down.');
  });

  it.each([
    [
      false,
      new HttpErrorResponse({ status: 502 }),
      'Cardmarket’s product list isn’t available right now.',
    ],
    [false, new HttpErrorResponse({ status: 500 }), 'Couldn’t load Cardmarket’s products.'],
    [true, new HttpErrorResponse({ status: 0 }), 'Matching needs a connection.'],
  ])('explains a failed load (offline: %s) and tries again', async (offline, error, message) => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: !offline });
    await create({ failure: error });
    expect(text('matcher-error')).toBe(message);

    matches.candidates.mockResolvedValue(answer());
    query('matcher-retry')?.click();
    await settle();

    expect(query('candidate-286309')).not.toBeNull();
  });

  it('closes on Cancel', async () => {
    await create();

    query('matcher-cancel')?.click();

    expect(modals.dismiss).toHaveBeenCalledWith(undefined, 'cancel');
  });
});
