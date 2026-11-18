import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { VisibilityService } from './visibility.service';

describe('VisibilityService', () => {
  let report: IntersectionObserverCallback = () => undefined;
  const observe = vi.fn();
  const unobserve = vi.fn();
  const disconnect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          report = callback;
        }
        observe = observe;
        unobserve = unobserve;
        disconnect = disconnect;
      }
    );
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const intersect = (target: Element, isIntersecting: boolean) => {
    report([{ target, isIntersecting } as unknown as IntersectionObserverEntry], {} as never);
  };

  it('calls back once, when an element first nears the viewport', () => {
    const service = TestBed.inject(VisibilityService);
    const element = document.createElement('div');
    const visible = vi.fn();

    service.whenVisible(element, visible);
    intersect(element, false);
    expect(visible).not.toHaveBeenCalled();

    intersect(element, true);
    intersect(element, true);
    expect(visible).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledWith(element);
    expect(unobserve).toHaveBeenCalledWith(element);
  });

  it('stops watching when cancelled, and disconnects when destroyed', () => {
    const service = TestBed.inject(VisibilityService);
    const element = document.createElement('div');
    const visible = vi.fn();

    service.whenVisible(element, visible)();
    intersect(element, true);
    expect(visible).not.toHaveBeenCalled();
    expect(unobserve).toHaveBeenCalledWith(element);

    TestBed.resetTestingModule();
    expect(disconnect).toHaveBeenCalled();
  });
});
