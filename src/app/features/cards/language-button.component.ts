import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import {
  IonButton,
  IonIcon,
  IonItem,
  IonList,
  IonPopover,
  IonRadio,
  IonRadioGroup,
} from '@ionic/angular';
import type { CatalogLanguage } from '@pokepaper/shared';
import { LANGUAGE_LABELS } from '../../core/services/catalog-language.service';
import { addIcons } from 'ionicons';
import { languageOutline } from 'ionicons/icons';

let nextId = 0;

/**
 * Header language switch (docs/ui.md): an IonButton with the current
 * language's code, opening an IonPopover with an IonRadioGroup of the
 * languages the set or card exists in.
 */
@Component({
  selector: 'app-language-button',
  template: `
    <ion-button
      [id]="triggerId"
      [disabled]="languages().length < 2"
      [attr.aria-label]="'Language: ' + label().name"
      data-testid="language-button"
    >
      <ion-icon slot="start" name="language-outline"></ion-icon>
      {{ label().short }}
    </ion-button>
    <ion-popover [trigger]="triggerId" [dismissOnSelect]="true">
      <ng-template>
        <ion-list lines="none">
          <ion-radio-group [value]="value()" (ionChange)="changed.emit($event.detail.value)">
            @for (language of languages(); track language) {
              <ion-item>
                <ion-radio [value]="language">{{ labels[language].name }}</ion-radio>
              </ion-item>
            }
          </ion-radio-group>
        </ion-list>
      </ng-template>
    </ion-popover>
  `,
  imports: [IonButton, IonIcon, IonPopover, IonList, IonRadioGroup, IonItem, IonRadio],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LanguageButtonComponent {
  constructor() {
    addIcons({ languageOutline });
  }

  readonly languages = input.required<readonly CatalogLanguage[]>();
  readonly value = input.required<CatalogLanguage>();
  readonly changed = output<CatalogLanguage>();

  readonly triggerId = `language-button-${String(nextId++)}`;
  readonly labels = LANGUAGE_LABELS;
  readonly label = computed(() => LANGUAGE_LABELS[this.value()]);
}
