import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ModalController } from '@ionic/angular';
import { DEFAULT_CATALOG_LANGUAGES } from '@pokepaper/shared';
import { vi } from 'vitest';
import { makeContractPack } from '../../core/data/storage-engine.contract';
import { CatalogLanguageService } from '../../core/services/catalog-language.service';
import { ImageCacheService } from '../../core/services/image-cache.service';
import { VisibilityService } from '../../core/services/visibility.service';
import { CardDetailComponent } from './card-detail.component';

const swiper = vi.hoisted(() => ({
  instances: [] as {
    activeIndex: number;
    options: Record<string, unknown>;
    updateSlides: () => void;
    updateSlidesClasses: () => void;
    updateAutoHeight: (speed: number) => void;
    destroy: () => void;
  }[],
}));

vi.mock('swiper', () => ({
  default: class {
    activeIndex = 0;
    readonly updateSlides = vi.fn();
    readonly updateSlidesClasses = vi.fn();
    readonly updateAutoHeight = vi.fn();
    readonly destroy = vi.fn();
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
        { provide: ModalController, useValue: { dismiss } },
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
    fixture.detectChanges();
    expect(detail.language()).toBe('fr');
    expect(root().querySelector('app-language-button')).not.toBeNull();
  });

  it('destroys Swiper with the modal', () => {
    create(0);

    fixture.destroy();

    expect(swiper.instances[0]?.destroy).toHaveBeenCalledWith(true, false);
  });
});
