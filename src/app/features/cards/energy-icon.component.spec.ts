import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { EnergyIconComponent } from './energy-icon.component';

describe('EnergyIconComponent', () => {
  function create(type: string): ComponentFixture<EnergyIconComponent> {
    const fixture = TestBed.createComponent(EnergyIconComponent);
    fixture.componentRef.setInput('type', type);
    fixture.detectChanges();
    return fixture;
  }

  const element = (fixture: ComponentFixture<EnergyIconComponent>) =>
    fixture.nativeElement as HTMLElement;

  it('shows the symbol image for a known type', () => {
    const img = element(create('Psychic')).querySelector('img');

    expect(img?.getAttribute('src')).toBe('assets/energy/psychic.png');
    expect(img?.getAttribute('alt')).toBe('Psychic');
  });

  it('falls back to a letter circle for an unknown type', () => {
    const root = element(create('Plasma'));
    const fallback = root.querySelector('.fallback');

    expect(root.querySelector('img')).toBeNull();
    expect(fallback?.textContent.trim()).toBe('?');
    expect(fallback?.getAttribute('aria-label')).toBe('Plasma');
  });

  it('falls back to a letter circle when the image fails to load', () => {
    const fixture = create('Fire');
    element(fixture).querySelector('img')?.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    const root = element(fixture);

    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('.fallback')?.getAttribute('aria-label')).toBe('Fire');
  });
});
