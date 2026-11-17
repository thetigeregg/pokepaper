import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ENERGY_COLORS, ENERGY_SYMBOL, isEnergyType } from './energy';

/**
 * An energy symbol (attack costs, rules text). TEMPORARY STAND-IN: a colored
 * circle with the type's letter, until suitably licensed artwork matching the
 * real TCG symbols is found (docs/ui.md → Energy symbols). Screen readers get
 * the type name.
 */
@Component({
  selector: 'app-energy-icon',
  template: `
    <span
      class="energy"
      role="img"
      [attr.aria-label]="type()"
      [title]="type()"
      [style.background]="color()"
      [style.color]="ink()"
    >
      {{ letter() }}
    </span>
  `,
  styles: [
    `
      .energy {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.15em;
        height: 1.15em;
        border-radius: 50%;
        font-size: 0.8em;
        font-weight: 700;
        line-height: 1;
        vertical-align: -0.15em;
        margin: 0 0.05em;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnergyIconComponent {
  /** Canonical (English) type, e.g. `Psychic`. */
  readonly type = input.required<string>();

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
