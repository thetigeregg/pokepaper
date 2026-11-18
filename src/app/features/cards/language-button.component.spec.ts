import { TestBed } from '@angular/core/testing';
import { LanguageButtonComponent } from './language-button.component';

describe('LanguageButtonComponent', () => {
  function create(languages: string[], value = 'en') {
    const fixture = TestBed.createComponent(LanguageButtonComponent);
    fixture.componentRef.setInput('languages', languages);
    fixture.componentRef.setInput('value', value);
    fixture.detectChanges();
    return fixture;
  }

  it('offers the languages in display order, German second', () => {
    const button = create(['en', 'fr', 'it', 'de']).componentInstance;

    expect(button.ordered()).toEqual(['en', 'de', 'fr', 'it']);
  });

  it('labels the button with the current language, disabled with only one', () => {
    const fixture = create(['de'], 'de');
    const element = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="language-button"]'
    );

    expect(element?.getAttribute('aria-label')).toBe('Language: Deutsch');
    expect((element as HTMLIonButtonElement | null)?.disabled).toBe(true);
  });
});
