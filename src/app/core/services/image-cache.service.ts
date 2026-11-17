import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ImageFileStore } from '../data/image-file-store';
import type {
  ImageCacheRecord,
  ImageCacheUsage,
  StorageEngine,
  StoredImageRef,
} from '../data/storage-engine';
import { StorageEngineFactory } from '../data/storage-engine.factory';
import { PreferenceStorageService } from '../storage/preference-storage.service';
import { isNativePlatform } from '../utils/native-platform.util';

/** Preference: how many megabytes of recently viewed (unpinned) images to keep. */
export const IMAGE_CACHE_LIMIT_KEY = 'pokepaper.images.cacheLimitMb';
export const DEFAULT_IMAGE_CACHE_LIMIT_MB = 500;
export const IMAGE_CACHE_LIMIT_OPTIONS_MB = [250, 500, 1000, 2000] as const;
/** After evicting, recently viewed images take at most this share of the limit. */
const EVICT_TO = 0.9;
/** A cached image's last-viewed time is refreshed at most this often. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

/** What `store` did with an image. */
export type ImageStoreResult = 'cached' | 'downloaded' | 'missing';

/**
 * Card images on this device (docs/catalog.md → Images on the device).
 *
 * Images are keyed by their same-origin URL (`/images/catalog/...`) and kept
 * as blobs in IndexedDB on the web, or as files (`ImageFileStore`) in the
 * iOS app. Recently viewed images are capped at a configurable size and the
 * least recently viewed go first; images pinned by a downloaded set
 * (`ImageDownloadService`) are never evicted.
 */
@Injectable({ providedIn: 'root' })
export class ImageCacheService {
  private readonly http = inject(HttpClient);
  private readonly storageEngineFactory = inject(StorageEngineFactory);
  private readonly fileStore = inject(ImageFileStore);
  private readonly preferences = inject(PreferenceStorageService);

  private readonly objectUrls = new Map<string, string>();
  private readonly inFlight = new Map<string, Promise<ImageStoreResult>>();
  /** Images the server answered 404 for this session; not asked again. */
  private readonly missing = new Set<string>();
  private evicting: Promise<void> | null = null;

  private readonly _usage = signal<ImageCacheUsage | null>(null);
  readonly usage = this._usage.asReadonly();

  private readonly _limitMb = signal(DEFAULT_IMAGE_CACHE_LIMIT_MB);
  readonly limitMb = this._limitMb.asReadonly();
  private limitLoaded: Promise<void> | null = null;

  private get engine(): StorageEngine {
    return this.storageEngineFactory.getEngine();
  }

  /**
   * A displayable URL for the image at `url`, downloading and caching it on
   * first use. Null when the server has no such image.
   */
  async resolve(url: string): Promise<string | null> {
    const cached = await this.displayCached(url);
    if (cached) {
      return cached;
    }
    if ((await this.store(url)) === 'missing') {
      return null;
    }
    return this.displayCached(url);
  }

  /**
   * Makes sure the image at `url` is on the device, downloading it if needed,
   * and pins it for `pinFor` (a set key) so it's never evicted.
   */
  async store(url: string, pinFor?: string): Promise<ImageStoreResult> {
    if (this.missing.has(url)) {
      return 'missing';
    }
    const existing = await this.engine.getImage(url);
    if (existing && (await this.hasBytes(existing))) {
      if (pinFor) {
        await this.engine.pinImages(pinFor, [url]);
      }
      return 'cached';
    }

    const pending = this.inFlight.get(url);
    const download = pending ?? this.download(url, pinFor);
    if (!pending) {
      this.inFlight.set(url, download);
      void download.finally(() => {
        this.inFlight.delete(url);
      });
    }
    const result = await download;
    // A concurrent caller started the (possibly unpinned) download: pin for
    // this caller too. If eviction took the image before the pin landed,
    // download it again, stored and pinned together.
    if (pending && pinFor && result !== 'missing') {
      await this.engine.pinImages(pinFor, [url]);
      if (!(await this.engine.getImage(url))) {
        return this.store(url, pinFor);
      }
    }
    return result;
  }

  /** Removes all recently viewed (unpinned) images. */
  async clearRecentlyViewed(): Promise<void> {
    await this.removeStored(await this.engine.deleteUnpinnedImages());
    await this.refreshUsage();
  }

  /** Sets the recently-viewed limit and evicts down to it. */
  async setLimitMb(limitMb: number): Promise<void> {
    this._limitMb.set(limitMb);
    await this.preferences.setItem(IMAGE_CACHE_LIMIT_KEY, String(limitMb));
    await this.enforceLimit();
  }

  async refreshUsage(): Promise<void> {
    await this.loadLimit();
    this._usage.set(await this.engine.imageCacheUsage());
  }

  /**
   * Evicts least recently viewed unpinned images until they fit the limit.
   * Concurrent calls share one pass.
   */
  enforceLimit(): Promise<void> {
    this.evicting ??= this.evict().finally(() => {
      this.evicting = null;
    });
    return this.evicting;
  }

  private async evict(): Promise<void> {
    await this.loadLimit();
    const target = this._limitMb() * 1024 * 1024 * EVICT_TO;
    let { unpinnedBytes } = await this.engine.imageCacheUsage();
    if (unpinnedBytes > this._limitMb() * 1024 * 1024) {
      while (unpinnedBytes > target) {
        // Oldest first, taking only as many as needed to get under the target.
        const candidates = await this.engine.listEvictableImages(50);
        const batch: StoredImageRef[] = [];
        for (const ref of candidates) {
          if (unpinnedBytes <= target) {
            break;
          }
          batch.push(ref);
          unpinnedBytes -= ref.size;
        }
        if (batch.length === 0) {
          break;
        }
        // Re-checks pins: a download may have pinned one since it was listed.
        await this.removeStored(await this.engine.evictImages(batch.map((ref) => ref.key)));
      }
    }
    this._usage.set(await this.engine.imageCacheUsage());
  }

  private async download(url: string, pinFor: string | undefined): Promise<ImageStoreResult> {
    let blob: Blob;
    try {
      blob = await firstValueFrom(
        this.http.get(`${environment.apiUrl}${url}`, { responseType: 'blob' })
      );
    } catch (error: unknown) {
      if (error instanceof HttpErrorResponse && error.status === 404) {
        this.missing.add(url);
        return 'missing';
      }
      throw error;
    }

    const record: ImageCacheRecord = {
      key: url,
      size: blob.size,
      lastAccessedAt: new Date().toISOString(),
      ...(isNativePlatform()
        ? { filePath: (await this.fileStore.writeImage(url, blob)).filePath }
        : { blob }),
    };
    // Stored and pinned together, so eviction can't take it in between.
    await this.engine.runInTransaction(['imageCache', 'imagePins'], async () => {
      await this.engine.putImage(record);
      if (pinFor) {
        await this.engine.pinImages(pinFor, [url]);
      }
    });
    if (!pinFor) {
      void this.enforceLimit();
    }
    return 'downloaded';
  }

  /** The cached image's display URL, refreshing its last-viewed time; null if not cached. */
  private async displayCached(url: string): Promise<string | null> {
    const record = await this.engine.getImage(url);
    if (!record) {
      return null;
    }
    const display = record.blob
      ? this.objectUrl(url, record.blob)
      : record.filePath
        ? await this.fileStore.getDisplayUrl(record.filePath)
        : null;
    if (!display) {
      return null; // The file was purged (iOS); download it again.
    }
    if (Date.now() - Date.parse(record.lastAccessedAt) > TOUCH_INTERVAL_MS) {
      await this.engine.touchImage(url, new Date().toISOString());
    }
    return display;
  }

  private async hasBytes(record: ImageCacheRecord): Promise<boolean> {
    if (record.blob) {
      return true;
    }
    return record.filePath ? this.fileStore.exists(record.filePath) : false;
  }

  private objectUrl(key: string, blob: Blob): string {
    let url = this.objectUrls.get(key);
    if (!url) {
      url = URL.createObjectURL(blob);
      this.objectUrls.set(key, url);
    }
    return url;
  }

  /** Releases object URLs and deletes files for removed images. */
  private async removeStored(refs: readonly StoredImageRef[]): Promise<void> {
    for (const ref of refs) {
      const objectUrl = this.objectUrls.get(ref.key);
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        this.objectUrls.delete(ref.key);
      }
      if (ref.filePath) {
        await this.fileStore.deleteImage(ref.filePath);
      }
    }
  }

  private loadLimit(): Promise<void> {
    this.limitLoaded ??= this.preferences.getItem(IMAGE_CACHE_LIMIT_KEY).then((stored) => {
      const value = Number(stored);
      if (stored && Number.isInteger(value) && value > 0) {
        this._limitMb.set(value);
      }
    });
    return this.limitLoaded;
  }
}
