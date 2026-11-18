import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { vi } from 'vitest';
import { LayoutService } from '../../core/services/layout.service';
import { HeaderActionsComponent, type HeaderAction } from './header-actions.component';

describe('HeaderActionsComponent', () => {
  const wide = signal(false);
  const run = { a: vi.fn(), b: vi.fn(), c: vi.fn() };
  const actions: HeaderAction[] = [
    { id: 'a', label: 'Action A', icon: 'list-outline', run: run.a },
    { id: 'b', label: 'Action B', icon: 'grid-outline', run: run.b },
    { id: 'c', label: 'Action C', icon: 'cloud-download-outline', disabled: true, run: run.c },
  ];

  let fixture: ComponentFixture<HeaderActionsComponent>;

  function create(list: HeaderAction[], pinned?: number): HeaderActionsComponent {
    fixture = TestBed.createComponent(HeaderActionsComponent);
    fixture.componentRef.setInput('actions', list);
    if (pinned !== undefined) {
      fixture.componentRef.setInput('pinned', pinned);
    }
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  const query = (selector: string) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLIonButtonElement>(selector);
  const buttonIds = () =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('ion-button')].map((b) =>
      b.getAttribute('data-testid')
    );

  beforeEach(() => {
    vi.clearAllMocks();
    wide.set(false);
    TestBed.configureTestingModule({ providers: [{ provide: LayoutService, useValue: { wide } }] });
  });

  it('shows every action as a labeled icon button on desktop', () => {
    wide.set(true);
    const component = create(actions);

    expect(buttonIds()).toEqual(['a-button', 'b-button', 'c-button']);
    expect(component.menu()).toEqual([]);
    expect(query('[data-testid="b-button"]')?.getAttribute('aria-label')).toBe('Action B');
    expect(query('[data-testid="c-button"]')?.disabled).toBe(true);

    query('[data-testid="a-button"]')?.click();
    expect(run.a).toHaveBeenCalledOnce();
  });

  it('keeps the first action and moves the rest to a More menu on phones', () => {
    const component = create(actions);

    expect(buttonIds()).toEqual(['a-button', 'more-button']);
    expect(component.menu().map((a) => a.id)).toEqual(['b', 'c']);
  });

  it('pins as many buttons as asked', () => {
    const component = create(actions, 0);

    expect(buttonIds()).toEqual(['more-button']);
    expect(component.menu().map((a) => a.id)).toEqual(['a', 'b', 'c']);
  });

  it("doesn't make a menu of one action", () => {
    const component = create(actions.slice(0, 2));

    expect(buttonIds()).toEqual(['a-button', 'b-button']);
    expect(component.menu()).toEqual([]);
  });

  it('collapses and expands as the screen width changes', () => {
    create(actions);
    wide.set(true);
    fixture.detectChanges();

    expect(buttonIds()).toEqual(['a-button', 'b-button', 'c-button']);
  });

  it('opens the menu and runs a picked action once it has closed', () => {
    const component = create(actions);
    const event = new Event('click');

    component.openMenu(event);
    expect(component.menuEvent()).toBe(event);

    component.pick(actions[1]);
    expect(component.menuEvent()).toBeNull();
    expect(run.b).not.toHaveBeenCalled();

    component.menuClosed();
    expect(run.b).toHaveBeenCalledOnce();

    component.menuClosed(); // Closed again without a pick: runs nothing more.
    expect(run.b).toHaveBeenCalledOnce();
  });

  it('runs nothing when the menu is dismissed without a pick', () => {
    const component = create(actions);

    component.openMenu(new Event('click'));
    component.menuClosed();

    expect(component.menuEvent()).toBeNull();
    expect(Object.values(run).some((fn) => fn.mock.calls.length)).toBe(false);
  });
});
