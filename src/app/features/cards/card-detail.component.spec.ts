import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ModalController } from '@ionic/angular';
import { DEFAULT_CATALOG_LANGUAGES } from '@pokepaper/shared';
import { vi } from 'vitest';
import { makeContractPack } from '../../core/data/storage-engine.contract';
import { CatalogPriceService } from '../../core/services/catalog-price.service';
import { CurrencyService } from '../../core/services/currency.service';
import { CatalogLanguageService } from '../../core/services/catalog-language.service';
import { CollectionService } from '../../core/services/collection.service';
import { LayoutService } from '../../core/services/layout.service';
import { ImageCacheService } from '../../core/services/image-cache.service';
import { VisibilityService } from '../../core/services/visibility.service';
import { CardDetailComponent, LOAD_MORE_WITHIN } from './card-detail.component';
import type { CatalogCard } from '@pokepaper/shared';

/** An empty collection, for specs that don't test collection tracking. */
const EMPTY_COLLECTION: Partial<CollectionService> = {
  loaded: signal(true),
  quantity: () => 0,
  cardTotal: () => 0,
  otherLanguages: () => [],
  ownedInSet: () => 0,
};

const swiper = vi.hoisted(() => ({
  instances: [] as {
    activeIndex: number;
    options: Record<string, unknown>;
    updateSlides: () => void;
    updateSlidesClasses: () => void;
    updateAutoHeight: (speed: number) => void;
    destroy: () => void;
    virtual: { appendSlide: (slides: unknown[]) => void };
    slideTo: (index: number, speed: number, runCallbacks: boolean) => void;
  }[],
}));

vi.mock('swiper', () => ({
  default: class {
    activeIndex = 0;
    readonly updateSlides = vi.fn();
    readonly updateSlidesClasses = vi.fn();
    readonly updateAutoHeight = vi.fn();
    readonly destroy = vi.fn();
    readonly virtual = { appendSlide: vi.fn() };
    readonly slideTo = vi.fn();
    constructor(
      _element: unknown,
      readonly options: Record<string, unknown>
    ) {
      swiper.instances.push(this);
    }
  },
}));
vi.mock('swiper/modules', () => ({ Keyboard: {}, Virtual: {} }));

describe('CardDetailComponent', () => {
  const pack = makeContractPack('intl', 'sv01', ['sv01-001', 'sv01-002', 'sv01-003']);
  const cards = [...pack.cards].sort((a, b) => a.sortIndex - b.sortIndex);
  const dismiss = vi.fn(() => Promise.resolve(true));
  const pick = vi.fn(() => Promise.resolve());

  let fixture: ComponentFixture<CardDetailComponent>;

  function create(startIndex: number) {
    fixture = TestBed.createComponent(CardDetailComponent);
    const component = fixture.componentInstance;
    component.setProp = pack.set;
    component.cardsProp = cards;
    component.startIndex = startIndex;
    fixture.detectChanges();
    return component;
  }

  const root = () => fixture.nativeElement as HTMLElement;
  const options = () =>
    swiper.instances[0]?.options as {
      initialSlide: number;
      virtual: {
        slides: unknown[];
        renderExternal: (data: { offset: number; from: number; slides: unknown[] }) => void;
      };
      on: { slideChange: (instance: { activeIndex: number }) => void };
    };

  beforeEach(() => {
    vi.clearAllMocks();
    swiper.instances.length = 0;
    TestBed.configureTestingModule({
      providers: [
        { provide: CollectionService, useValue: EMPTY_COLLECTION },
        { provide: ModalController, useValue: { dismiss } },
        { provide: LayoutService, useValue: { wide: signal(false) } },
        {
          // A remembered language other than the default, to tell them apart.
          provide: CatalogLanguageService,
          useValue: { forSet: () => 'fr', pick, languages: signal({ intl: 'fr', asia: 'ja' }) },
        },
        {
          provide: ImageCacheService,
          useValue: { resolve: () => Promise.resolve(null), release: vi.fn() },
        },
        { provide: VisibilityService, useValue: { whenVisible: () => () => undefined } },
        {
          provide: CatalogPriceService,
          useValue: {
            version: signal(0),
            prices: () => Promise.resolve(undefined),
            setFlagsReverseHolos: () => Promise.resolve(false),
          },
        },
        {
          provide: CurrencyService,
          useValue: { currency: signal('EUR'), rates: signal(null), format: String },
        },
      ],
    });
  });

  it('starts at the tapped card with virtual slides', () => {
    const detail = create(1);

    expect(detail.index()).toBe(1);
    expect(detail.title()).toBe('sv01-002');
    expect(root().querySelector('ion-title')?.textContent).toBe('sv01-002');
    expect(options().initialSlide).toBe(1);
    expect(options().virtual.slides).toHaveLength(3);
  });

  it('renders the window of slides Swiper asks for, then resizes to them', async () => {
    const detail = create(0);

    options().virtual.renderExternal({ offset: 390, from: 0, slides: cards.slice(0, 2) });
    fixture.detectChanges();

    expect(detail.window()).toEqual({ offset: 390, from: 0, slides: cards.slice(0, 2) });
    const slides = [...root().querySelectorAll<HTMLElement>('.swiper-slide')];
    expect(slides.map((slide) => slide.dataset['swiperSlideIndex'])).toEqual(['0', '1']);
    expect(slides[0]?.style.left).toBe('390px');
    expect(root().querySelectorAll('app-card-details')).toHaveLength(2);

    // The component's frame callback was queued first, so it has run by ours.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(swiper.instances[0]?.updateSlides).toHaveBeenCalled();
    expect(swiper.instances[0]?.updateAutoHeight).toHaveBeenCalledWith(0);
  });

  it('resizes when a rendered slide’s content changes height', async () => {
    let resized: () => void = () => undefined;
    const observed: Element[] = [];
    const disconnect = vi.fn(() => {
      observed.length = 0;
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe(element: Element) {
          observed.push(element);
        }
        disconnect = disconnect;
      }
    );
    try {
      create(0);
      options().virtual.renderExternal({ offset: 0, from: 0, slides: cards.slice(0, 2) });
      fixture.detectChanges();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(observed).toEqual([...root().querySelectorAll('.swiper-slide')]);
      expect(observed).toHaveLength(2);
      const updateAutoHeight = swiper.instances[0]?.updateAutoHeight;
      vi.clearAllMocks();

      resized();
      expect(updateAutoHeight).toHaveBeenCalledWith(0);

      fixture.destroy();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('titles the card paged to', () => {
    const detail = create(0);

    options().on.slideChange({ activeIndex: 2 });
    fixture.detectChanges();

    expect(detail.index()).toBe(2);
    expect(root().querySelector('ion-title')?.textContent).toBe('sv01-003');
  });

  it('switches language and closes', () => {
    const detail = create(0);
    detail.pickLanguage('de');
    (root().querySelector('[data-testid="card-close"]') as HTMLElement).click();

    expect(pick).toHaveBeenCalledWith('intl', 'de');
    expect(dismiss).toHaveBeenCalled();
  });

  it('defaults the language until ngOnInit copies the modal props', () => {
    fixture = TestBed.createComponent(CardDetailComponent);
    const detail = fixture.componentInstance;

    expect(detail.set()).toBeNull();
    expect(detail.language()).toBe(DEFAULT_CATALOG_LANGUAGES.intl);
    expect(detail.title()).toBe('');
    detail.pickLanguage('de');
    expect(pick).not.toHaveBeenCalled();

    detail.setProp = pack.set;
    detail.cardsProp = cards;
    fixture.detectChanges();
    expect(detail.language()).toBe('fr');
    expect(root().querySelector('app-language-button')).not.toBeNull();
  });

  it('pages through cards from several sets, each with its own set', () => {
    const other = makeContractPack('intl', 'sv02', ['sv02-001']);
    other.set.languages = ['de'];
    fixture = TestBed.createComponent(CardDetailComponent);
    const detail = fixture.componentInstance;
    detail.setsProp = new Map([
      ['intl:sv01', pack.set],
      ['intl:sv02', other.set],
    ]);
    detail.cardsProp = [cards[0], other.cards[0]];
    fixture.detectChanges();

    expect(detail.set()).toBe(pack.set);
    options().on.slideChange({ activeIndex: 1 });
    expect(detail.set()).toBe(other.set);
    expect(detail.setFor(cards[0])).toBe(pack.set);
  });

  describe('loading more cards to page through', () => {
    const many = makeContractPack(
      'intl',
      'sv01',
      Array.from({ length: LOAD_MORE_WITHIN + 5 }, (_, n) => `sv01-${String(n + 1)}`)
    );
    const manyCards = [...many.cards].sort((a, b) => a.sortIndex - b.sortIndex);
    const extra = makeContractPack('intl', 'sv01', ['sv01-x1', 'sv01-x2']).cards;

    function open(startIndex: number, loadMore: () => Promise<CatalogCard[]>) {
      fixture = TestBed.createComponent(CardDetailComponent);
      const component = fixture.componentInstance;
      component.setProp = many.set;
      component.cardsProp = manyCards;
      component.startIndex = startIndex;
      component.loadMoreProp = loadMore;
      fixture.detectChanges();
      return component;
    }

    it('loads the next page near the end and appends it to the slides', async () => {
      const loadMore = vi.fn(() => Promise.resolve([...manyCards, ...extra]));
      const detail = open(0, loadMore);
      expect(loadMore).not.toHaveBeenCalled(); // Far from the end.

      options().on.slideChange({ activeIndex: manyCards.length - LOAD_MORE_WITHIN });
      await vi.waitFor(() => {
        expect(swiper.instances[0]?.virtual.appendSlide).toHaveBeenCalledWith(extra);
      });
      expect(detail.cards()).toHaveLength(manyCards.length + extra.length);
    });

    it('loads more straight away when it opens near the end, once at a time', async () => {
      let release!: (cards: CatalogCard[]) => void;
      const loadMore = vi.fn(
        () =>
          new Promise<CatalogCard[]>((resolve) => {
            release = resolve;
          })
      );
      open(manyCards.length - 1, loadMore);
      options().on.slideChange({ activeIndex: manyCards.length - 1 }); // While it loads.
      expect(loadMore).toHaveBeenCalledTimes(1);

      release(manyCards); // Nothing new: the results are all loaded.
      await new Promise((resolve) => setTimeout(resolve));
      expect(swiper.instances[0]?.virtual.appendSlide).not.toHaveBeenCalled();
    });

    it('stays on its card when appending right after opening moves Swiper', async () => {
      const detail = open(manyCards.length - 1, () => Promise.resolve([...manyCards, ...extra]));
      const instance = swiper.instances.at(0);
      if (!instance) {
        throw new Error('no Swiper');
      }
      instance.activeIndex = manyCards.length - 1;
      vi.mocked(instance.virtual.appendSlide).mockImplementation(() => {
        instance.activeIndex = 0; // Swiper re-reads its position before the first layout.
      });

      await vi.waitFor(() => {
        expect(instance.slideTo).toHaveBeenCalledWith(manyCards.length - 1, 0, false);
      });
      expect(detail.index()).toBe(manyCards.length - 1);
    });

    it('keeps paging what it has when loading more fails', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const detail = open(manyCards.length - 1, () => Promise.reject(new Error('disk')));

      await vi.waitFor(() => {
        expect(error).toHaveBeenCalledWith(
          'catalog.card_detail_load_more_failed',
          expect.any(Error)
        );
      });
      expect(detail.cards()).toHaveLength(manyCards.length);
      error.mockRestore();
    });
  });

  it('destroys Swiper with the modal', () => {
    create(0);

    fixture.destroy();

    expect(swiper.instances[0]?.destroy).toHaveBeenCalledWith(true, false);
  });
});
