import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { catalogCardImageUrl, type CatalogCard, type CatalogCardText } from '@pokepaper/shared';
import { vi } from 'vitest';
import { makeContractCard } from '../../core/data/storage-engine.contract';
import { ImageCacheService } from '../../core/services/image-cache.service';
import { VisibilityService } from '../../core/services/visibility.service';
import { CardImageComponent } from './card-image.component';

describe('CardImageComponent', () => {
  const base = makeContractCard('intl', 'sv01', 'sv01-001', 0);
  const resolve = vi.fn<(url: string) => Promise<string | null>>();
  const release = vi.fn();
  let onVisible: (() => void) | undefined;
  const stopWatching = vi.fn();

  function create(
    card: CatalogCard,
    inputs: Partial<{ language: string; quality: string; setLine: string }> = {}
  ): ComponentFixture<CardImageComponent> {
    const fixture = TestBed.createComponent(CardImageComponent);
    fixture.componentRef.setInput('card', card);
    fixture.componentRef.setInput('language', inputs.language ?? 'en');
    if (inputs.quality) fixture.componentRef.setInput('quality', inputs.quality);
    if (inputs.setLine) fixture.componentRef.setInput('setLine', inputs.setLine);
    fixture.detectChanges();
    return fixture;
  }

  /** Lets the image load (native async/await, which Zone.js can't track) finish, then renders. */
  async function settle(fixture: ComponentFixture<CardImageComponent>): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }

  const query = (fixture: ComponentFixture<CardImageComponent>, selector: string) =>
    (fixture.nativeElement as HTMLElement).querySelector(selector);

  beforeEach(() => {
    vi.clearAllMocks();
    onVisible = undefined;
    resolve.mockImplementation((url) => Promise.resolve(`blob:${url}`));
    TestBed.configureTestingModule({
      providers: [
        { provide: ImageCacheService, useValue: { resolve, release } },
        {
          provide: VisibilityService,
          useValue: {
            whenVisible: (_element: Element, callback: () => void) => {
              onVisible = callback;
              return stopWatching;
            },
          },
        },
      ],
    });
  });

  it('waits for the grid image to scroll into view, then shows the scan', async () => {
    const fixture = create(base);
    await settle(fixture);

    expect(resolve).not.toHaveBeenCalled();
    expect(query(fixture, 'ion-skeleton-text')).not.toBeNull();

    onVisible?.();
    await settle(fixture);

    const url = catalogCardImageUrl(base, 'en', 'low');
    const img = query(fixture, 'img') as HTMLImageElement;
    expect(resolve).toHaveBeenCalledWith(url);
    expect(img.getAttribute('src')).toBe(`blob:${url}`);
    expect(img.alt).toBe('sv01-001');
    expect(query(fixture, '.fallback')).toBeNull();
  });

  it('loads high-quality detail images right away', async () => {
    const fixture = create(base, { quality: 'high' });
    await settle(fixture);

    expect(resolve).toHaveBeenCalledWith(catalogCardImageUrl(base, 'en', 'high'));
    expect(query(fixture, 'img')).not.toBeNull();
  });

  it("badges another language's scan when the language has none", async () => {
    const fixture = create(base, { language: 'de', quality: 'high' });
    await settle(fixture);

    expect(resolve).toHaveBeenCalledWith(catalogCardImageUrl(base, 'en', 'high'));
    expect(query(fixture, '.fallback')?.textContent.trim()).toBe('EN');
  });

  it('shows a tinted text card when no language has a scan', async () => {
    const card: CatalogCard = {
      ...base,
      hp: 110,
      stage: 'Stage1',
      types: ['Fire'],
      text: { en: { ...base.text.en, image: null } as CatalogCardText },
    };
    const fixture = create(card, { setLine: 'SVI · 001/198' });
    await settle(fixture);

    expect(resolve).not.toHaveBeenCalled();
    expect(query(fixture, 'ion-card-title')?.textContent).toBe('sv01-001');
    expect(query(fixture, 'ion-card-subtitle')?.textContent).toBe('HP 110 · Stage 1');
    expect(query(fixture, '.set-line')?.textContent).toBe('SVI · 001/198');
    expect(query(fixture, 'app-energy-icon')).not.toBeNull();
    expect(fixture.componentInstance.tint()).not.toBeNull();
  });

  it('shows the text card when the server has no such image', async () => {
    resolve.mockResolvedValue(null);
    const fixture = create(base, { quality: 'high' });
    await settle(fixture);

    expect(fixture.componentInstance.state()).toBe('none');
    expect(query(fixture, 'ion-card')).not.toBeNull();
  });

  it('shows the text card when offline and not cached', async () => {
    resolve.mockRejectedValue(new Error('offline'));
    const fixture = create(base, { quality: 'high' });
    await settle(fixture);

    expect(fixture.componentInstance.state()).toBe('none');
  });

  it('keeps showing the scan when a refresh brings the same image', async () => {
    const fixture = create(base, { quality: 'high' });
    await settle(fixture);

    fixture.componentRef.setInput('card', { ...base });
    fixture.detectChanges();

    expect(fixture.componentInstance.state()).toBe('image');
    await settle(fixture);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('stops watching and releases the image when destroyed', async () => {
    const fixture = create(base, { quality: 'high' });
    await settle(fixture);

    fixture.destroy();

    expect(stopWatching).toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(catalogCardImageUrl(base, 'en', 'high'));
  });
});
