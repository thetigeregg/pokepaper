import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import {
  IonBadge,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonSkeletonText,
} from '@ionic/angular';
import type { CatalogCard, CatalogImageQuality, CatalogLanguage } from '@pokepaper/shared';
import { ImageCacheService } from '../../core/services/image-cache.service';
import { ImageSlot } from '../../core/services/image-slot';
import { VisibilityService } from '../../core/services/visibility.service';
import { LANGUAGE_LABELS } from '../../core/services/catalog-language.service';
import { displayImage } from '../../core/utils/catalog-image.util';
import { cardSubtitle, cardText, cardTint } from './card-display';
import { ENERGY_COLORS, isEnergyType } from './energy';
import { EnergyIconComponent } from './energy-icon.component';

type ImageState = 'loading' | 'image' | 'none';

/**
 * A card's scan in `language` (docs/ui.md → Card images): cached on the
 * device, loaded when it scrolls into view. When the language has no scan,
 * another language's is shown with a badge; when none has one, a
 * type-tinted IonCard with the card's name, HP · stage and set number.
 */
@Component({
  selector: 'app-card-image',
  templateUrl: 'card-image.component.html',
  styleUrl: 'card-image.component.scss',
  imports: [
    IonBadge,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardSubtitle,
    IonCardContent,
    IonSkeletonText,
    EnergyIconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardImageComponent {
  private readonly slot = new ImageSlot(inject(ImageCacheService));

  readonly card = input.required<CatalogCard>();
  readonly language = input.required<CatalogLanguage>();
  readonly quality = input<CatalogImageQuality>('low');
  /** Bottom line of the no-scan card, e.g. "SVI · 001/198". */
  readonly setLine = input('');

  private readonly visible = signal(false);
  readonly state = signal<ImageState>('loading');
  readonly src = signal<string | null>(null);

  readonly image = computed(() => displayImage(this.card(), this.language(), this.quality()));
  /** The scan's language when it isn't the requested one (shown as a badge). */
  readonly fallbackLabel = computed(() => {
    const image = this.image();
    return image && image.language !== this.language()
      ? LANGUAGE_LABELS[image.language].short
      : null;
  });
  readonly name = computed(() => cardText(this.card(), this.language())?.name ?? this.card().id);
  readonly subtitle = computed(() => cardSubtitle(this.card()));
  readonly tintType = computed(() => cardTint(this.card()));
  readonly tint = computed(() => {
    const type = this.tintType();
    return type && isEnergyType(type) ? ENERGY_COLORS[type] : null;
  });

  constructor() {
    // Grid images load when they scroll into view; detail images right away.
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const stopWatching = inject(VisibilityService).whenVisible(element, () => {
      this.visible.set(true);
    });
    inject(DestroyRef).onDestroy(() => {
      stopWatching();
      this.slot.clear();
    });

    effect(() => {
      const image = this.image();
      const wanted = this.quality() === 'high' || this.visible();
      untracked(() => {
        if (!image) {
          this.slot.clear();
          this.state.set('none');
        } else if (wanted) {
          void this.load(image.url);
        }
      });
    });
  }

  private async load(url: string): Promise<void> {
    // Fresh card objects with the same image (a catalog refresh) keep showing it.
    if (this.slot.current !== url) {
      this.state.set('loading');
    }
    try {
      const src = await this.slot.show(url);
      if (src === undefined) {
        return; // Superseded (language changed meanwhile).
      }
      this.src.set(src);
      this.state.set(src ? 'image' : 'none');
    } catch {
      // Offline and not cached: show the card's details instead.
      if (this.image()?.url === url) {
        this.state.set('none');
      }
    }
  }
}
