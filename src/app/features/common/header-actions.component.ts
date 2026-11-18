import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { IonButton, IonIcon, IonItem, IonLabel, IonList, IonPopover } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { ellipsisHorizontalCircleOutline } from 'ionicons/icons';
import { LayoutService } from '../../core/services/layout.service';

let nextId = 0;

/** One header action: an icon button on desktop, maybe a menu row on phones. */
export interface HeaderAction {
  /** Names its test ids: `<id>-button` as a button, `<id>-action` as a menu row. */
  readonly id: string;
  /** The button's accessible label, and the menu row's text. */
  readonly label: string;
  readonly icon: string;
  readonly disabled?: boolean;
  readonly run: () => void;
}

/**
 * Header toolbar actions (docs/ui.md → Page layout), placed inside an
 * `ion-buttons` slot. On desktop every action is an icon-only IonButton. On
 * phones the first `pinned` stay buttons and the rest move to a More button
 * (`ellipsis-horizontal-circle-outline`) opening an IonPopover menu, so a slot
 * never holds more than two buttons. A menu of one would be pointless, so that
 * action stays a button.
 */
@Component({
  selector: 'app-header-actions',
  styles: [':host { display: contents; }'],
  template: `
    @for (action of buttons(); track action.id) {
      <ion-button
        (click)="action.run()"
        [disabled]="action.disabled ?? false"
        [attr.aria-label]="action.label"
        [attr.data-testid]="action.id + '-button'"
      >
        <ion-icon slot="icon-only" [name]="action.icon"></ion-icon>
      </ion-button>
    }
    @if (menu().length) {
      <ion-button
        [id]="triggerId"
        [disabled]="menuDisabled()"
        aria-label="More"
        aria-haspopup="menu"
        data-testid="more-button"
      >
        <ion-icon slot="icon-only" name="ellipsis-horizontal-circle-outline"></ion-icon>
      </ion-button>
      <ion-popover
        cssClass="header-actions-menu"
        [trigger]="triggerId"
        [translucent]="true"
        [dismissOnSelect]="true"
        (willPresent)="menuOpening()"
        (didDismiss)="menuClosed()"
      >
        <ng-template>
          <ion-list>
            @for (action of menu(); track action.id) {
              <ion-item
                button
                lines="full"
                [detail]="false"
                (click)="pick(action)"
                [disabled]="action.disabled ?? false"
                [attr.data-testid]="action.id + '-action'"
              >
                <ion-icon slot="start" [name]="action.icon" aria-hidden="true"></ion-icon>
                <ion-label class="ion-text-nowrap">{{ action.label }}</ion-label>
              </ion-item>
            }
          </ion-list>
        </ng-template>
      </ion-popover>
    }
  `,
  imports: [IonButton, IonIcon, IonPopover, IonList, IonItem, IonLabel],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeaderActionsComponent {
  private readonly layout = inject(LayoutService);

  constructor() {
    addIcons({ ellipsisHorizontalCircleOutline });
  }

  readonly actions = input.required<readonly HeaderAction[]>();
  /** How many actions stay buttons on phones (the rest go in the menu). */
  readonly pinned = input(1);

  readonly triggerId = `header-actions-${String(nextId++)}`;

  private readonly collapsed = computed(() => {
    const actions = this.actions();
    return !this.layout.wide() && actions.length > this.keep() + 1;
  });
  /** `pinned`, never below 0. */
  private readonly keep = computed(() => Math.max(0, this.pinned()));
  readonly buttons = computed(() =>
    this.collapsed() ? this.actions().slice(0, this.keep()) : this.actions()
  );
  readonly menu = computed(() => (this.collapsed() ? this.actions().slice(this.keep()) : []));
  /** More is disabled when nothing in its menu can run. */
  readonly menuDisabled = computed(() => this.menu().every((action) => action.disabled));

  /**
   * The id of the menu row picked, run once the menu has closed (so a sheet it
   * opens doesn't overlap the closing menu).
   */
  private picked: string | null = null;

  /** Forgets a pick left over from a menu that went away before it closed (e.g. on a resize). */
  menuOpening(): void {
    this.picked = null;
  }

  pick(action: HeaderAction): void {
    this.picked = action.id;
  }

  /** Runs the picked action, as it is now: not if it has since gone or been disabled. */
  menuClosed(): void {
    const id = this.picked;
    this.picked = null;
    const action = this.actions().find((candidate) => candidate.id === id);
    if (action && !action.disabled) {
      action.run();
    }
  }
}
