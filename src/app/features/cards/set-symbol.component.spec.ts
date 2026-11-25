import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { CatalogRegion } from '@pokepaper/shared';
import { SetSymbolComponent } from './set-symbol.component';
import { SET_SYMBOL_WIDTHS } from './set-symbol';

describe('SetSymbolComponent', () => {
  function create(
    setId: string,
    region: CatalogRegion = 'intl'
  ): ComponentFixture<SetSymbolComponent> {
    const fixture = TestBed.createComponent(SetSymbolComponent);
    fixture.componentRef.setInput('region', region);
    fixture.componentRef.setInput('setId', setId);
    fixture.detectChanges();
    return fixture;
  }

  const element = (fixture: ComponentFixture<SetSymbolComponent>) =>
    fixture.nativeElement as HTMLElement;
  const images = (fixture: ComponentFixture<SetSymbolComponent>) => [
    ...element(fixture).querySelectorAll('img'),
  ];

  it('shows the symbol as a decorative image', () => {
    const fixture = create('sv08');
    const [img] = images(fixture);

    expect(images(fixture)).toHaveLength(1);
    expect(img.getAttribute('src')).toBe('assets/set-symbols/sv08.png');
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('aria-hidden')).toBe('true');
    // Its size reserves the space before it loads.
    expect([img.getAttribute('width'), img.getAttribute('height')]).toEqual([
      String(SET_SYMBOL_WIDTHS['sv08']),
      '48',
    ]);
    expect(element(fixture).classList).toContain('shown');
  });

  it('renders nothing for a set without a symbol', () => {
    for (const fixture of [create('base1'), create('SV8', 'asia')]) {
      expect(images(fixture)).toHaveLength(0);
      expect(element(fixture).classList).not.toContain('shown');
    }
  });

  it('hides an image that fails to load, until the set changes', () => {
    const fixture = create('sv08');
    images(fixture)[0].dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(images(fixture)).toHaveLength(0);
    expect(element(fixture).classList).not.toContain('shown');

    fixture.componentRef.setInput('setId', 'sv07');
    fixture.detectChanges();
    expect(images(fixture).map((img) => img.getAttribute('src'))).toEqual([
      'assets/set-symbols/sv07.png',
    ]);
  });
});
