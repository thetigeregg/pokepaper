import { Injectable, computed, inject, signal } from '@angular/core';
import { inLanguageOrder, displayImage, regionLanguages } from '../utils/catalog-image.util';
import type { CatalogLanguage, CatalogRegion } from '@pokepaper/shared';
import { catalogKey, type StorageEngine } from '../data/storage-engine';
import { StorageEngineFactory } from '../data/storage-engine.factory';
import { ImageCacheService } from './image-cache.service';

/** Images downloaded at once. */
export const IMAGE_DOWNLOAD_CONCURRENCY = 4;

/** A running (or just finished) set download. */
export interface SetDownloadProgress {
  done: number;
  total: number;
  /** Images the server didn't have (skipped, not fatal). */
  missing: number;
  /** Images that failed to download (retried by downloading again). */
  failed: number;
  running: boolean;
}

/** A set whose images are kept for offline use. */
export interface OfflineSet {
  setKey: string;
  region: CatalogRegion;
  setId: string;
  /** The set's name in the first language it has (English for international sets). */
  name: string;
  /** `region:serieId`, for grouping. */
  serieKey: string;
  serieName: string;
  releaseDate: string | null;
  /** Languages it was downloaded in. */
  languages: CatalogLanguage[];
  /** Pinned images on the device, and their size. */
  images: number;
  bytes: number;
}

/** Thrown inside a download that was cancelled. */
class DownloadCancelled extends Error {
  override readonly name = 'DownloadCancelled';
}

/**
 * "Download images for this set": fetches and pins the grid-size scans of a
 * set's cards so they're available offline and never evicted
 * (docs/catalog.md → Images on the device).
 *
 * For each card and requested language, it pins the scan the app would
 * actually show: that language's, else the fallback language's
 * (`displayImage`). Images already on the device are just pinned, so running
 * it again resumes an interrupted download. Removing a set unpins its
 * images; they then count as recently viewed and fall under the cache limit.
 */
@Injectable({ providedIn: 'root' })
export class ImageDownloadService {
  private readonly storageEngineFactory = inject(StorageEngineFactory);
  private readonly imageCache = inject(ImageCacheService);

  private readonly _progress = signal<ReadonlyMap<string, SetDownloadProgress>>(new Map());
  /** Progress by set key (`region:setId`). */
  readonly progress = this._progress.asReadonly();

  private readonly _offlineSets = signal<OfflineSet[]>([]);
  /** Downloaded sets, newest release first. */
  readonly offlineSets = this._offlineSets.asReadonly();
  /** Bytes come from actual pinned usage, so an image two sets share counts once. */
  readonly totals = computed(() => ({
    sets: this._offlineSets().length,
    bytes:
      this.imageCache.usage()?.pinnedBytes ??
      this._offlineSets().reduce((total, set) => total + set.bytes, 0),
  }));

  private readonly cancelled = new Set<string>();
  /** Running downloads by set key, registered before their first await. */
  private readonly running = new Map<string, Promise<void>>();

  private get engine(): StorageEngine {
    return this.storageEngineFactory.getEngine();
  }

  /**
   * Downloads and pins a set's images in `languages` (each card's own scan,
   * or its fallback). Resolves when done or cancelled; a second call for the
   * same set while one runs joins it instead of starting another.
   */
  downloadSet(
    region: CatalogRegion,
    setId: string,
    languages: readonly CatalogLanguage[]
  ): Promise<void> {
    const setKey = catalogKey(region, setId);
    const existing = this.running.get(setKey);
    if (existing) {
      return existing;
    }
    this.cancelled.delete(setKey);
    const run = this.runDownload(region, setId, setKey, languages).finally(() => {
      this.running.delete(setKey);
    });
    this.running.set(setKey, run);
    return run;
  }

  private async runDownload(
    region: CatalogRegion,
    setId: string,
    setKey: string,
    languages: readonly CatalogLanguage[]
  ): Promise<void> {
    const cards = await this.engine.listCatalogCards(region, setId);
    const wanted = languages.filter((language) => regionLanguages(region).includes(language));
    const previous = (await this.engine.listDownloadedSets()).find(
      (record) => record.setKey === setKey
    );
    await this.engine.putDownloadedSet({
      setKey,
      languages: inLanguageOrder([...(previous?.languages ?? []), ...wanted]),
      downloadedAt: new Date().toISOString(),
    });
    const urls = [
      ...new Set(
        cards.flatMap((card) =>
          wanted
            .map((language) => displayImage(card, language, 'low')?.url)
            .filter((url) => url !== undefined)
        )
      ),
    ];

    this.update(setKey, { done: 0, total: urls.length, missing: 0, failed: 0, running: true });
    const queue = [...urls];
    const worker = async (): Promise<void> => {
      for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
        if (this.cancelled.has(setKey)) {
          throw new DownloadCancelled();
        }
        let outcome: 'done' | 'missing' | 'failed' = 'done';
        try {
          if ((await this.imageCache.store(url, setKey)) === 'missing') {
            outcome = 'missing';
          }
        } catch {
          outcome = 'failed';
        }
        this.bump(setKey, outcome);
      }
    };
    await Promise.allSettled(
      Array.from({ length: Math.min(IMAGE_DOWNLOAD_CONCURRENCY, urls.length) }, worker)
    );

    const current = this._progress().get(setKey);
    if (current) {
      this.update(setKey, { ...current, running: false });
    }
    await this.refresh();
  }

  /** Stops a running download after the images in flight. What's downloaded stays pinned. */
  cancel(region: CatalogRegion, setId: string): void {
    this.cancelled.add(catalogKey(region, setId));
  }

  /** Unpins a downloaded set; its images then fall under the recently-viewed limit. */
  removeSet(setKey: string): Promise<void> {
    return this.removeSets([setKey]);
  }

  /** Unpins several downloaded sets (a series, or all of them). */
  async removeSets(setKeys: readonly string[]): Promise<void> {
    for (const setKey of setKeys) {
      this.cancelled.add(setKey);
      // Let a running download stop first, so images it has in flight can't
      // re-pin themselves after the set is removed.
      await this.running.get(setKey)?.catch(() => undefined);
      await this.engine.runInTransaction(['imagePins', 'downloadedSets'], async () => {
        await this.engine.unpinSet(setKey);
        await this.engine.deleteDownloadedSet(setKey);
      });
    }
    const progress = new Map(this._progress());
    for (const setKey of setKeys) {
      progress.delete(setKey);
    }
    this._progress.set(progress);
    await this.imageCache.enforceLimit();
    await this.refresh();
  }

  /** Reloads the list of downloaded sets and the cache usage. */
  async refresh(): Promise<void> {
    const [downloaded, pinned, sets, series] = await Promise.all([
      this.engine.listDownloadedSets(),
      this.engine.listPinnedSets(),
      this.engine.listCatalogSets(),
      this.engine.listCatalogSeries(),
    ]);
    const pinnedByKey = new Map(pinned.map((summary) => [summary.setKey, summary]));
    const setByKey = new Map(sets.map((stored) => [stored.key, stored.set]));
    const serieNames = new Map(
      series.map((entry) => [
        catalogKey(entry.region, entry.id),
        Object.values(entry.names)[0] ?? entry.id,
      ])
    );

    this._offlineSets.set(
      downloaded
        .map((record): OfflineSet => {
          const [region, ...rest] = record.setKey.split(':') as [CatalogRegion, ...string[]];
          const setId = rest.join(':');
          const set = setByKey.get(record.setKey);
          const serieKey = catalogKey(region, set?.serieId ?? '');
          const summary = pinnedByKey.get(record.setKey);
          return {
            setKey: record.setKey,
            region,
            setId,
            name: (set && Object.values(set.names)[0]) ?? setId,
            serieKey,
            serieName: serieNames.get(serieKey) ?? set?.serieId ?? '',
            releaseDate: set?.releaseDate ?? null,
            languages: record.languages,
            images: summary?.images ?? 0,
            bytes: summary?.bytes ?? 0,
          };
        })
        .sort(
          (a, b) =>
            (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '') || a.name.localeCompare(b.name)
        )
    );
    await this.imageCache.refreshUsage();
  }

  private update(setKey: string, progress: SetDownloadProgress): void {
    this._progress.set(new Map(this._progress()).set(setKey, progress));
  }

  private bump(setKey: string, outcome: 'done' | 'missing' | 'failed'): void {
    const current = this._progress().get(setKey);
    if (current) {
      this.update(setKey, {
        ...current,
        done: current.done + 1,
        missing: current.missing + (outcome === 'missing' ? 1 : 0),
        failed: current.failed + (outcome === 'failed' ? 1 : 0),
      });
    }
  }
}
