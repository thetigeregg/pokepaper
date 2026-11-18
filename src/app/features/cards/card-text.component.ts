import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { EnergyIconComponent } from './energy-icon.component';
import { parseCardText } from './energy';

/** Card rules text with its energy symbols ({P}, {R}, …) shown as icons. */
@Component({
  selector: 'app-card-text',
  template: `
    @for (segment of segments(); track $index) {
      @if ('energy' in segment) {
        <app-energy-icon [type]="segment.energy" />
      } @else {
        {{ segment.text }}
      }
    }
  `,
  imports: [EnergyIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardTextComponent {
  readonly text = input<string | null>(null);
  readonly segments = computed(() => parseCardText(this.text() ?? ''));
}
