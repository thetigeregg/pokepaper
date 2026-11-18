import { Injectable, OnDestroy } from '@angular/core';

/** How far outside the viewport lazy content starts loading. */
const LAZY_ROOT_MARGIN = '300px';

/**
 * Tells lazy content (card scans, set logos) when it first comes near the
 * viewport, with one shared IntersectionObserver for every element.
 */
@Injectable({ providedIn: 'root' })
export class VisibilityService implements OnDestroy {
  private readonly callbacks = new Map<Element, () => void>();
  private readonly observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const callback = this.callbacks.get(entry.target);
          this.unobserve(entry.target);
          callback?.();
        }
      }
    },
    { rootMargin: LAZY_ROOT_MARGIN }
  );

  /** Calls `onVisible` once, when `element` first nears the viewport. Returns a cancel function. */
  whenVisible(element: Element, onVisible: () => void): () => void {
    this.callbacks.set(element, onVisible);
    this.observer.observe(element);
    return () => {
      this.unobserve(element);
    };
  }

  ngOnDestroy(): void {
    this.observer.disconnect();
    this.callbacks.clear();
  }

  private unobserve(element: Element): void {
    if (this.callbacks.delete(element)) {
      this.observer.unobserve(element);
    }
  }
}
