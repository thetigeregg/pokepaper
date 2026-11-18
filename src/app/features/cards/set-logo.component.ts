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
import { IonIcon } from '@ionic/angular';
import { catalogSetImageUrl, type CatalogLanguage, type CatalogSet } from '@pokepaper/shared';
import { addIcons } from 'ionicons';
import { albumsOutline } from 'ionicons/icons';
import { ImageCacheService } from '../../core/services/image-cache.service';
import { ImageSlot } from '../../core/services/image-slot';
import { VisibilityService } from '../../core/services/visibility.service';
import { setLogoUrl } from './card-display';

/**
 * A set's logo in `language` (else another language's), cached on the
 * device and loaded as it nears the viewport. In the sets list it falls back
 * to the set's symbol, then an icon; with `logoOnly` (the set page header) it
 * shows its projected content, the set's name, instead.
 */
@Component({
  selector: 'app-set-logo',
  host: { '[class.logo-only]': 'logoOnly()' },
  template: `
    @if (src(); as url) {
      <img [src]="url" [alt]="alt()" />
    } @else if (logoOnly()) {
      <ng-content />
    } @else {
      <ion-icon name="albums-outline" color="medium"></ion-icon>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
      }
      img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }
      ion-icon {
        font-size: 1.5rem;
      }
      /* Header: a title-sized logo, or the name truncated like a title. */
      :host(.logo-only) {
        display: block;
        height: auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      :host(.logo-only) img {
        display: block;
        max-width: min(60vw, 280px);
        max-height: 32px;
        margin: 0 auto;
      }
    `,
  ],
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetLogoComponent {
  private readonly slot = new ImageSlot(inject(ImageCacheService));

  readonly set = input.required<CatalogSet>();
  readonly language = input.required<CatalogLanguage>();
  /** Only the logo, else the projected content (no symbol or icon). */
  readonly logoOnly = input(false);
  /** The image's alt text (empty when the name is shown beside it). */
  readonly alt = input('');
  readonly src = signal<string | null>(null);
  private readonly visible = signal(false);

  private readonly candidates = computed(() => {
    const set = this.set();
    const logo = setLogoUrl(set, this.language());
    return [
      ...(logo ? [logo] : []),
      ...(set.symbol && !this.logoOnly() ? [catalogSetImageUrl(set, { kind: 'symbol' })] : []),
    ];
  });

  constructor() {
    addIcons({ albumsOutline });
    // Logos load as rows near the viewport (a catalog lists ~220 sets).
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const stopWatching = inject(VisibilityService).whenVisible(element, () => {
      this.visible.set(true);
    });
    inject(DestroyRef).onDestroy(() => {
      stopWatching();
      this.slot.clear();
    });

    effect(() => {
      const candidates = this.candidates();
      if (this.visible()) {
        untracked(() => void this.load(candidates));
      }
    });
  }

  private async load(candidates: readonly string[]): Promise<void> {
    for (const url of candidates) {
      if (candidates !== this.candidates()) {
        return; // The set or language changed meanwhile; a newer load decides.
      }
      try {
        const src = await this.slot.show(url);
        if (src === undefined || candidates !== this.candidates()) {
          return;
        }
        if (src) {
          this.src.set(src);
          return;
        }
      } catch {
        // Offline and not cached: try the next, else the fallback.
      }
    }
    if (candidates === this.candidates()) {
      this.slot.clear();
      this.src.set(null);
    }
  }
}
