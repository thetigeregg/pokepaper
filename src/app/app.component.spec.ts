import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  it('creates', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    TestBed.overrideComponent(AppComponent, { set: { template: '<div></div>' } });
    await TestBed.compileComponents();

    expect(TestBed.createComponent(AppComponent).componentInstance).toBeTruthy();
  });
});
