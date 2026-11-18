import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { ENERGY_COLORS, ENERGY_SYMBOL, isEnergyType } from './energy';

/**
 * Whether `src/assets/energy/<type>.png` exist. Deferred for now (docs/ui.md
 * → Components): until they're added, every icon is the letter circle and no
 * image is requested. Set to true when the PNGs are committed.
 */
export const ENERGY_ICON_IMAGES: boolean = false;

/**
 * An energy symbol (types, attack costs, rules text): the TCG symbol from
 * `assets/energy/<type>.png` (docs/ui.md → Components). Falls back to a
 * colored circle with the type's letter for an unknown type or an image that
 * fails to load. Screen readers get the type name.
 */
@Component({
  selector: 'app-energy-icon',
  template: `
    @if (src(); as src) {
      <img class="energy" [src]="src" [alt]="type()" [title]="type()" (error)="failed.set(true)" />
    } @else {
      <span
        class="energy fallback"
        role="img"
        [attr.aria-label]="type()"
        [title]="type()"
        [style.background]="color()"
        [style.color]="ink()"
      >
        {{ letter() }}
      </span>
    }
  `,
  styles: [
    `
      :host {
        display: inline-block;
        margin: 0 0.05em;
        vertical-align: -0.2em;
        line-height: 0;
      }
      .energy {
        width: 1.2em;
        height: 1.2em;
      }
      .fallback {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        font-size: 0.8em;
        font-weight: 700;
        line-height: 1;
        width: 1.5em;
        height: 1.5em;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnergyIconComponent {
  /** Canonical (English) type, e.g. `Psychic`. */
  readonly type = input.required<string>();

  readonly failed = signal(false);
  readonly src = computed(() => {
    const type = this.type();
    return ENERGY_ICON_IMAGES && isEnergyType(type) && !this.failed() ? energyIconUrl(type) : null;
  });
  readonly color = computed(() => {
    const type = this.type();
    return isEnergyType(type) ? ENERGY_COLORS[type] : 'var(--ion-color-medium)';
  });
  readonly ink = computed(() =>
    ['Lightning', 'Colorless', 'Metal'].includes(this.type()) ? '#222' : '#fff'
  );
  readonly letter = computed(() => {
    const type = this.type();
    return isEnergyType(type) ? ENERGY_SYMBOL[type] : '?';
  });
}

/** `assets/energy/psychic.png` for `Psychic`. */
export function energyIconUrl(type: string): string {
  return `assets/energy/${type.toLowerCase()}.png`;
}
