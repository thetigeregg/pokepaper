import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TabsPage } from './tabs.page';

describe('TabsPage', () => {
  it('creates', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    TestBed.overrideComponent(TabsPage, { set: { template: '<div></div>' } });
    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(TabsPage);

    expect(fixture.componentInstance).toBeTruthy();
  });
});
