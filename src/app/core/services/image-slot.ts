import type { ImageCacheService } from './image-cache.service';

/**
 * The one image a component shows at a time, resolved through
 * `ImageCacheService`: holds the shown image's display URL, releases it when
 * replaced or cleared, and drops results superseded by a newer request.
 */
export class ImageSlot {
  /** The image URL being resolved, else the one shown. */
  private requested: string | null = null;
  private shown: { url: string; src: string } | null = null;

  constructor(private readonly imageCache: ImageCacheService) {}

  /** The image URL currently shown, if any. */
  get current(): string | null {
    return this.shown?.url ?? null;
  }

  /**
   * Resolves `url` for display: its display URL, null if the server has no
   * such image, or undefined if a newer `show`/`clear` superseded it. Throws
   * when it can't be resolved (offline and not cached); the slot is then
   * empty.
   */
  async show(url: string): Promise<string | null | undefined> {
    if (this.shown?.url === url) {
      this.requested = url;
      return this.shown.src; // Unchanged: no reload.
    }
    this.requested = url;
    let src: string | null;
    try {
      src = await this.imageCache.resolve(url);
    } catch (error: unknown) {
      if (this.requested === url) {
        this.clear();
      }
      throw error;
    }
    if (this.requested !== url) {
      if (src) {
        this.imageCache.release(url);
      }
      return undefined;
    }
    this.releaseShown();
    this.shown = src ? { url, src } : null;
    return src;
  }

  /** Shows nothing: releases the shown image and drops pending requests. */
  clear(): void {
    this.requested = null;
    this.releaseShown();
  }

  private releaseShown(): void {
    if (this.shown) {
      this.imageCache.release(this.shown.url);
      this.shown = null;
    }
  }
}
