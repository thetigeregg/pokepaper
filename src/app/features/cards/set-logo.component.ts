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
import { setLogoUrl } from './card-display';
import { ImageCacheService } from '../../core/services/image-cache.service';
import { addIcons } from 'ionicons';
import { albumsOutline } from 'ionicons/icons';

/** A set's logo in `language` (else another language's, else its symbol), cached on the device. */
@Component({
  selector: 'app-set-logo',
  template: `
    @if (src(); as url) {
      <img [src]="url" alt="" />
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
    `,
  ],
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetLogoComponent {
  private readonly imageCache = inject(ImageCacheService);

  readonly set = input.required<CatalogSet>();
  readonly language = input.required<CatalogLanguage>();
  readonly src = signal<string | null>(null);
  private readonly visible = signal(false);

  private readonly candidates = computed(() => {
    const set = this.set();
    const logo = setLogoUrl(set, this.language());
    return [
      ...(logo ? [logo] : []),
      ...(set.symbol ? [catalogSetImageUrl(set, { kind: 'symbol' })] : []),
    ];
  });

  constructor() {
    addIcons({ albumsOutline });
    // Logos load as rows scroll into view (a catalog lists ~220 sets).
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          this.visible.set(true);
          observer.disconnect();
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(inject<ElementRef<HTMLElement>>(ElementRef).nativeElement);
    inject(DestroyRef).onDestroy(() => {
      observer.disconnect();
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
      try {
        const src = await this.imageCache.resolve(url);
        if (candidates !== this.candidates()) {
          return; // The set or language changed meanwhile; a newer load decides.
        }
        if (src) {
          this.src.set(src);
          return;
        }
      } catch {
        // Offline and not cached: try the next, else show the icon.
      }
    }
    if (candidates === this.candidates()) {
      this.src.set(null);
    }
  }
}
