import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import type { CatalogRegion } from '@pokepaper/shared';
import { SET_SYMBOL_HEIGHT, setSymbol } from './set-symbol';

/**
 * A set's symbol, shown before its name or set line (docs/ui.md →
 * Components): `assets/set-symbols/` images, International sets only.
 * Decorative, since the set is always named too; renders nothing for a set
 * without a symbol or an image that fails to load. The image's size
 * attributes reserve its space before it loads, so the text doesn't shift.
 * A host can scale the symbol with `--set-symbol-height` (default 1.25em).
 */
@Component({
  selector: 'app-set-symbol',
  host: { '[class.shown]': 'shown()' },
  template: `
    @if (shown()) {
      <img
        [src]="src()"
        [attr.width]="width()"
        [attr.height]="height"
        alt=""
        aria-hidden="true"
        data-testid="set-symbol"
        (error)="failedSrc.set(src())"
      />
    }
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        line-height: 0;
      }
      :host(.shown) {
        margin-inline-end: 0.3em;
      }
      img {
        height: var(--set-symbol-height, 1.25em);
        width: auto;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetSymbolComponent {
  readonly region = input.required<CatalogRegion>();
  /** TCGdex set ID, e.g. `sv08`. */
  readonly setId = input.required<string>();

  /** The image that failed to load, hidden until the set changes. */
  readonly failedSrc = signal<string | null>(null);
  private readonly symbol = computed(() => setSymbol(this.region(), this.setId()));
  readonly src = computed(() => this.symbol()?.url ?? '');
  readonly width = computed(() => this.symbol()?.width ?? null);
  readonly height = SET_SYMBOL_HEIGHT;
  readonly shown = computed(() => this.symbol() !== null && this.failedSrc() !== this.src());
}
