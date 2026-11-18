import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IonItem, IonLabel, IonList, IonListHeader, IonNote } from '@ionic/angular';
import type { CatalogCard, CatalogLanguage, CatalogSet } from '@pokepaper/shared';
import { cardSubtitle, cardText, retreatCost, retreatLabel, setLine } from './card-display';
import { CardImageComponent } from './card-image.component';
import { CardTextComponent } from './card-text.component';
import { EnergyIconComponent } from './energy-icon.component';

/**
 * One card's scan and full text in `language` (docs/ui.md → Card detail):
 * an IonList with sections for abilities, attacks, weakness · resistance ·
 * retreat, and details. Image above the text on phones, beside it on desktop.
 */
@Component({
  selector: 'app-card-details',
  templateUrl: 'card-details.component.html',
  styleUrl: 'card-details.component.scss',
  imports: [
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
    CardImageComponent,
    CardTextComponent,
    EnergyIconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardDetailsComponent {
  readonly card = input.required<CatalogCard>();
  readonly set = input.required<CatalogSet>();
  readonly language = input.required<CatalogLanguage>();

  readonly text = computed(() => cardText(this.card(), this.language()));
  readonly subtitle = computed(() => cardSubtitle(this.card()));
  readonly setLine = computed(() => setLine(this.set(), this.card()));
  /** Attacks: costs and damage from the card, names and effects in the language. */
  readonly attacks = computed(() =>
    this.card().attacks.map((attack, index) => ({
      ...attack,
      name: this.text()?.attacks[index]?.name ?? '',
      effect: this.text()?.attacks[index]?.effect ?? null,
    }))
  );
  /** The longest attack cost, for one shared cost column width. */
  readonly costSlots = computed(() =>
    Math.max(1, ...this.attacks().map((attack) => attack.cost.length))
  );
  readonly retreatCost = computed(() => retreatCost(this.card()));
  readonly retreatLabel = computed(() => retreatLabel(this.card()));
  readonly legal = computed(() => {
    const { standard, expanded } = this.card().legal;
    return [standard ? 'Standard' : null, expanded ? 'Expanded' : null].filter(Boolean).join(' · ');
  });
}
