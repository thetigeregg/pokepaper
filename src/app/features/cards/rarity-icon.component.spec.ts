import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { CatalogRegion } from '@pokepaper/shared';
import { RarityIconComponent } from './rarity-icon.component';

describe('RarityIconComponent', () => {
  function create(
    rarity: string | null,
    region: CatalogRegion = 'intl',
    seriesId?: string
  ): ComponentFixture<RarityIconComponent> {
    const fixture = TestBed.createComponent(RarityIconComponent);
    fixture.componentRef.setInput('rarity', rarity);
    fixture.componentRef.setInput('region', region);
    if (seriesId) {
      fixture.componentRef.setInput('seriesId', seriesId);
    }
    fixture.detectChanges();
    return fixture;
  }

  const element = (fixture: ComponentFixture<RarityIconComponent>) =>
    fixture.nativeElement as HTMLElement;
  const images = (fixture: ComponentFixture<RarityIconComponent>) => [
    ...element(fixture).querySelectorAll('img'),
  ];

  it('shows the symbol as a decorative image', () => {
    const fixture = create('Double rare', 'asia', 'SV');
    const [img] = images(fixture);

    expect(images(fixture)).toHaveLength(1);
    expect(img.getAttribute('src')).toBe('assets/rarity/jp/rr.png');
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('aria-hidden')).toBe('true');
    // Its size reserves the space before it loads.
    expect([img.getAttribute('width'), img.getAttribute('height')]).toEqual(['73', '48']);
    expect(element(fixture).classList).toContain('shown');
  });

  it("repeats TCG Pocket's symbols", () => {
    const fixture = create('Four Diamond');

    expect(images(fixture).map((img) => img.getAttribute('src'))).toEqual(
      Array(4).fill('assets/rarity/pocket/diamond.png')
    );
  });

  it('renders nothing for a rarity without a symbol', () => {
    const fixture = create('None');

    expect(images(fixture)).toHaveLength(0);
    expect(element(fixture).classList).not.toContain('shown');
  });

  it('hides an image that fails to load, until the rarity changes', () => {
    const fixture = create('Rare');
    images(fixture)[0].dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(images(fixture)).toHaveLength(0);

    fixture.componentRef.setInput('rarity', 'Common');
    fixture.detectChanges();
    expect(images(fixture).map((img) => img.getAttribute('src'))).toEqual([
      'assets/rarity/common.png',
    ]);
  });
});
