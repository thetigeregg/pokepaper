import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ModalController } from '@ionic/angular';
import { vi } from 'vitest';
import { makeContractPack } from '../../core/data/storage-engine.contract';
import { CatalogLanguageService } from '../../core/services/catalog-language.service';
import { CardDetailComponent } from './card-detail.component';

const swiper = vi.hoisted(() => ({
  instances: [] as {
    options: Record<string, unknown>;
    slideNext: () => void;
    slidePrev: () => void;
  }[],
}));

vi.mock('swiper', () => ({
  default: class {
    activeIndex = 0;
    readonly slideNext = vi.fn();
    readonly slidePrev = vi.fn();
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

  async function create(startIndex: number) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: ModalController, useValue: { dismiss } },
        {
          provide: CatalogLanguageService,
          useValue: { forSet: () => 'en', pick, languages: signal({ intl: 'en', asia: 'ja' }) },
        },
      ],
    });
    TestBed.overrideComponent(CardDetailComponent, {
      set: { template: '<div class="swiper"></div>', imports: [], styleUrl: undefined, styles: [] },
    });
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(CardDetailComponent);
    const component = fixture.componentInstance;
    component.setProp = pack.set;
    component.cardsProp = cards;
    component.startIndex = startIndex;
    fixture.detectChanges();
    return component;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    swiper.instances.length = 0;
  });

  it('starts at the tapped card with virtual slides', async () => {
    const detail = await create(1);
    const options = swiper.instances[0]?.options as {
      initialSlide: number;
      virtual: { slides: unknown[]; renderExternal: (data: unknown) => void };
    };

    expect(detail.index()).toBe(1);
    expect(detail.title()).toBe('sv01-002');
    expect(options.initialSlide).toBe(1);
    expect(options.virtual.slides).toHaveLength(3);

    options.virtual.renderExternal({ offset: 390, from: 0, slides: cards.slice(0, 2) });
    expect(detail.window()).toEqual({ offset: 390, from: 0, slides: cards.slice(0, 2) });
  });

  it('switches language and closes', async () => {
    const detail = await create(0);

    detail.pickLanguage('de');
    detail.close();

    expect(pick).toHaveBeenCalledWith('intl', 'de');
    expect(dismiss).toHaveBeenCalled();
  });
});
