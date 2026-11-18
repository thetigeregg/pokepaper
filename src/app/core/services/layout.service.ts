import { Injectable, signal } from '@angular/core';

/** Ionic's `lg` breakpoint: where the Cards tab shows its split view (docs/ui.md). */
export const WIDE_LAYOUT_QUERY = '(min-width: 992px)';

/** Whether the screen is wide enough for split views (desktop) or not (phone). */
@Injectable({ providedIn: 'root' })
export class LayoutService {
  private readonly query = window.matchMedia(WIDE_LAYOUT_QUERY);
  private readonly _wide = signal(this.query.matches);
  readonly wide = this._wide.asReadonly();

  constructor() {
    this.query.addEventListener('change', (event) => {
      this._wide.set(event.matches);
    });
  }
}
