import { Component, input } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { catalogSetImageUrl, type CatalogSet } from '@pokepaper/shared';
import { vi } from 'vitest';
import { makeContractPack } from '../../core/data/storage-engine.contract';
import { ImageCacheService } from '../../core/services/image-cache.service';
import { VisibilityService } from '../../core/services/visibility.service';
import { SetLogoComponent } from './set-logo.component';

@Component({
  imports: [SetLogoComponent],
  template: `
    <app-set-logo [set]="set()" language="en" [logoOnly]="logoOnly()" alt="Logo">
      <span class="name">Scarlet &amp; Violet</span>
    </app-set-logo>
  `,
})
class HostComponent {
  readonly set = input.required<CatalogSet>();
  readonly logoOnly = input(false);
}

describe('SetLogoComponent', () => {
  // A TCG Pocket set: it has no bundled symbol, so TCGdex's is the fallback.
  const plain = makeContractPack('intl', 'A1', []).set;
  const set: CatalogSet = { ...plain, logos: { en: 'en/tcgp/A1/logo' }, symbol: 'tcgp/A1/symbol' };
  // Surging Sparks: its symbol is bundled.
  const bundled: CatalogSet = {
    ...makeContractPack('intl', 'sv08', []).set,
    logos: { en: 'en/sv/sv08/logo' },
    symbol: 'sv/sv08/symbol',
  };
  const bundledLogo = catalogSetImageUrl(bundled, { kind: 'logo', language: 'en' });
  const logo = catalogSetImageUrl(set, { kind: 'logo', language: 'en' });
  const symbol = catalogSetImageUrl(set, { kind: 'symbol' });

  const resolve = vi.fn<(url: string) => Promise<string | null>>();
  const release = vi.fn();
  const stopWatching = vi.fn();
  let onVisible: (() => void) | undefined;

  async function create(
    hostSet: CatalogSet,
    logoOnly = false,
    visible = true
  ): Promise<ComponentFixture<HostComponent>> {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentRef.setInput('set', hostSet);
    fixture.componentRef.setInput('logoOnly', logoOnly);
    fixture.detectChanges();
    if (visible) onVisible?.();
    await settle(fixture);
    return fixture;
  }

  /** Lets the logo load (native async/await, which Zone.js can't track) finish, then renders. */
  async function settle(fixture: ComponentFixture<HostComponent>): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }

  const query = (fixture: ComponentFixture<HostComponent>, selector: string) =>
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

  it('loads nothing until it nears the viewport', async () => {
    const fixture = await create(set, false, false);

    expect(resolve).not.toHaveBeenCalled();
    expect(query(fixture, 'ion-icon')).not.toBeNull();
  });

  it('shows the logo in the language', async () => {
    const fixture = await create(set);
    const img = query(fixture, 'img') as HTMLImageElement;

    expect(resolve).toHaveBeenCalledWith(logo);
    expect(img.getAttribute('src')).toBe(`blob:${logo}`);
    expect(img.alt).toBe('Logo');
  });

  it('falls back to the symbol when the server has no logo', async () => {
    resolve.mockImplementation((url) => Promise.resolve(url === logo ? null : `blob:${url}`));
    const fixture = await create(set);

    expect((query(fixture, 'img') as HTMLImageElement).getAttribute('src')).toBe(`blob:${symbol}`);
  });

  it('falls back to the symbol when offline with no cached logo', async () => {
    resolve.mockImplementation((url) =>
      url === logo ? Promise.reject(new Error('offline')) : Promise.resolve(`blob:${url}`)
    );
    const fixture = await create(set);

    expect((query(fixture, 'img') as HTMLImageElement).getAttribute('src')).toBe(`blob:${symbol}`);
  });

  it('falls back to the bundled symbol, not TCGdex’s, when the server has no logo', async () => {
    resolve.mockResolvedValue(null);
    const fixture = await create(bundled);

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(bundledLogo);
    expect((query(fixture, 'img') as HTMLImageElement).getAttribute('src')).toBe(
      'assets/set-symbols/sv08.png'
    );
  });

  it('falls back to the bundled symbol when offline with no cached logo', async () => {
    resolve.mockRejectedValue(new Error('offline'));
    const fixture = await create(bundled);

    expect((query(fixture, 'img') as HTMLImageElement).getAttribute('src')).toBe(
      'assets/set-symbols/sv08.png'
    );
  });

  it('shows the bundled symbol for a set without other images', async () => {
    const fixture = await create({ ...bundled, logos: {}, symbol: null });

    expect(resolve).not.toHaveBeenCalled();
    expect((query(fixture, 'img') as HTMLImageElement).getAttribute('src')).toBe(
      'assets/set-symbols/sv08.png'
    );
  });

  it('prefers the logo to the bundled symbol', async () => {
    const fixture = await create(bundled);

    expect((query(fixture, 'img') as HTMLImageElement).getAttribute('src')).toBe(
      `blob:${bundledLogo}`
    );
  });

  it('shows an icon when the set has no images', async () => {
    const fixture = await create(plain);

    expect(resolve).not.toHaveBeenCalled();
    expect(query(fixture, 'img')).toBeNull();
    expect(query(fixture, 'ion-icon')).not.toBeNull();
  });

  it('shows the projected name instead in logo-only mode, never the symbol', async () => {
    resolve.mockResolvedValue(null);
    for (const hostSet of [set, bundled]) {
      resolve.mockClear();
      const fixture = await create(hostSet, true);

      expect(resolve).toHaveBeenCalledTimes(1);
      expect(resolve).toHaveBeenCalledWith(hostSet === set ? logo : bundledLogo);
      expect(query(fixture, 'img')).toBeNull();
      expect(query(fixture, '.name')?.textContent).toBe('Scarlet & Violet');
      expect(query(fixture, 'app-set-logo')?.classList).toContain('logo-only');
    }
  });

  it('switches to the new set’s logo', async () => {
    const fixture = await create(set);
    const other: CatalogSet = {
      ...set,
      id: 'A2',
      logos: { en: 'en/tcgp/A2/logo' },
      symbol: null,
    };

    fixture.componentRef.setInput('set', other);
    fixture.detectChanges();
    await settle(fixture);

    const otherLogo = catalogSetImageUrl(other, { kind: 'logo', language: 'en' });
    expect((query(fixture, 'img') as HTMLImageElement).getAttribute('src')).toBe(
      `blob:${otherLogo}`
    );
    expect(release).toHaveBeenCalledWith(logo);
  });

  it('stops watching and releases the logo when destroyed', async () => {
    const fixture = await create(set);

    fixture.destroy();

    expect(stopWatching).toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(logo);
  });
});
