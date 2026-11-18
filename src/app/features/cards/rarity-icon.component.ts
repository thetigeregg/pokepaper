import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import type { CatalogRegion } from '@pokepaper/shared';
import { rarityIcon, rarityIconUrl } from './rarity';

/**
 * A rarity's symbol, shown before its name (docs/ui.md → Components):
 * `assets/rarity/` images, repeated for TCG Pocket's counts. Decorative,
 * since the name is always shown too; renders nothing for a rarity without
 * a symbol or an image that fails to load.
 */
@Component({
  selector: 'app-rarity-icon',
  host: { '[class.shown]': 'copies().length > 0' },
  template: `
    @for (copy of copies(); track $index) {
      <img
        class="rarity"
        [src]="src()"
        alt=""
        aria-hidden="true"
        data-testid="rarity-icon"
        (error)="failedSrc.set(src())"
      />
    }
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        gap: 0.05em;
        vertical-align: -0.25em;
        line-height: 0;
      }
      :host(.shown) {
        margin-inline-end: 0.3em;
      }
      .rarity {
        height: 1.25em;
        width: auto;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RarityIconComponent {
  /** TCGdex rarity, e.g. `Double rare`. */
  readonly rarity = input.required<string | null | undefined>();
  readonly region = input.required<CatalogRegion>();
  /** The card's series; Asian sets before Black & White print symbols. */
  readonly seriesId = input<string>();

  /** The image that failed to load, hidden until the rarity changes. */
  readonly failedSrc = signal<string | null>(null);
  private readonly icon = computed(() => rarityIcon(this.rarity(), this.region(), this.seriesId()));
  readonly src = computed(() => {
    const icon = this.icon();
    return icon ? rarityIconUrl(icon.name) : '';
  });
  readonly copies = computed(() => {
    const icon = this.icon();
    return icon && this.failedSrc() !== this.src() ? Array.from({ length: icon.count }) : [];
  });
}
