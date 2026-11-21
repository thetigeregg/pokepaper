import {
  HttpClient,
  HttpErrorResponse,
  HttpHeaders,
  type HttpResponse,
} from '@angular/common/http';
import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import {
  CATALOG_REGIONS,
  type CatalogManifest,
  type CatalogManifestSet,
  type CatalogPricePack,
  type CatalogRegion,
  type CatalogSetPack,
} from '@pokepaper/shared';
import { Observable, Subject, firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { catalogKey, type CatalogStats, type StorageEngine } from '../data/storage-engine';
import { StorageEngineFactory } from '../data/storage-engine.factory';
import { isNativePlatform } from '../utils/native-platform.util';
import { SyncService } from './sync.service';

export const CATALOG_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Set packs downloaded at once. */
export const CATALOG_DOWNLOAD_CONCURRENCY = 3;
/** syncMeta: ETag of the last manifest whose sets were all downloaded. */
export const CATALOG_ETAG_KEY = 'catalogManifestEtag';
/** syncMeta: when the catalog was last confirmed current (ISO time). */
export const CATALOG_CHECKED_AT_KEY = 'catalogCheckedAt';
/** Attempts per set or price pack for rate limiting and temporary failures, including the first. */
export const CATALOG_PACK_ATTEMPTS = 4;

/** syncMeta: ETag of a region's last stored price pack. */
export function catalogPricesEtagKey(region: CatalogRegion): string {
  return `catalogPricesEtag:${region}`;
}

/** Errors worth retrying a pack for: rate limited, server trouble, or a dropped connection. */
function isTransient(error: unknown): error is HttpErrorResponse {
  return (
    error instanceof HttpErrorResponse &&
    (error.status === 0 || error.status === 429 || error.status >= 500)
  );
}

/** Retry delay: the server's `Retry-After` (capped at 60 s), else 1 s, 3 s, 9 s. */
function retryDelayMs(error: HttpErrorResponse, attempt: number): number {
  const retryAfter = Number(error.headers.get('retry-after'));
  return Number.isFinite(retryAfter) && retryAfter > 0
    ? Math.min(retryAfter, 60) * 1000
    : 1000 * 3 ** (attempt - 1);
}

/**
 * - `idle`: the catalog on this device matched the server at the last check
 *   (or no check has run yet)
 * - `checking`: fetching the manifest
 * - `downloading`: fetching changed sets (see `progress`)
 * - `offline`: no connectivity; the catalog on this device keeps working
 * - `unauthorized`: signed out, or the server rejected the session
 * - `error`: the last check failed; retried at the next trigger
 */
export type CatalogSyncStatus =
  'idle' | 'checking' | 'downloading' | 'offline' | 'unauthorized' | 'error';

/** Thrown inside a run that a sign-out or sign-in overtook, to stop it before its next request. */
class RunSuperseded extends Error {
  override readonly name = 'RunSuperseded';
}

/**
 * Keeps a full copy of the card catalog on this device (docs/catalog.md).
 *
 * Each run fetches the manifest (sending the last ETag, so an unchanged
 * catalog costs one empty 304), compares each set's hash with the stored
 * copy, downloads only the sets that differ (`CATALOG_DOWNLOAD_CONCURRENCY`
 * at a time, each stored atomically), and removes sets the server dropped.
 * The ETag is saved only after every set landed, so an interrupted download
 * resumes with the sets still missing. Then, for each region with sets on
 * this device, it fetches the region's price pack the same way (one 304 when
 * unchanged) and stores it whole.
 *
 * The catalog is read-only reference data: it never goes through the
 * outbox. Runs on app start, every `CATALOG_SYNC_INTERVAL_MS`, when the
 * browser comes back online, and on demand (`syncNow`). Follows the sign-in
 * state of `SyncService`: nothing is fetched while signed out.
 */
@Injectable({ providedIn: 'root' })
export class CatalogSyncService {
  private readonly http = inject(HttpClient);
  private readonly storageEngineFactory = inject(StorageEngineFactory);
  private readonly syncService = inject(SyncService);

  private readonly _status = signal<CatalogSyncStatus>('idle');
  readonly status = this._status.asReadonly();

  private readonly _progress = signal<{ done: number; total: number } | null>(null);
  /** Sets downloaded so far in the running download, or null when none is running. */
  readonly progress = this._progress.asReadonly();

  private readonly _lastChecked = signal<Date | null>(null);
  readonly lastChecked = this._lastChecked.asReadonly();

  private readonly _stats = signal<CatalogStats | null>(null);
  /** What's stored on this device; null until first read. */
  readonly stats = this._stats.asReadonly();

  private readonly _changed$ = new Subject<void>();
  /** Emits after each set is stored or removed, so screens can refresh as sets arrive. */
  readonly changed$: Observable<void> = this._changed$.asObservable();

  private inFlight: Promise<void> | null = null;
  private rerunRequested = false;
  private initialized = false;
  /** Bumped on sign-out and sign-in; a run started under an older value stops. */
  private epoch = 0;
  private wasUnauthorized = false;

  constructor() {
    effect(() => {
      const unauthorized = this.syncService.status() === 'unauthorized';
      untracked(() => {
        this.onSignInStateChange(unauthorized);
      });
    });
  }

  private get engine(): StorageEngine {
    return this.storageEngineFactory.getEngine();
  }

  /** Starts the schedule. Call once, after storage and auth are initialized. */
  initialize(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    void this.loadLocalState();
    void this.syncNow();
    window.setInterval(() => void this.syncNow(), CATALOG_SYNC_INTERVAL_MS);
    window.addEventListener('online', () => void this.syncNow());
  }

  /**
   * Checks for changes now. If a run is in flight, schedules one more after
   * it and returns the in-flight promise.
   */
  syncNow(): Promise<void> {
    if (this.inFlight) {
      this.rerunRequested = true;
      return this.inFlight;
    }
    if (this.syncService.status() === 'unauthorized') {
      this._status.set('unauthorized');
      return Promise.resolve();
    }
    if (!navigator.onLine) {
      this._status.set('offline');
      return Promise.resolve();
    }

    this.inFlight = this.runRepeatedly().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private onSignInStateChange(unauthorized: boolean): void {
    if (unauthorized === this.wasUnauthorized) {
      return;
    }
    this.wasUnauthorized = unauthorized;
    this.epoch += 1;
    if (unauthorized) {
      this._status.set('unauthorized');
      this._progress.set(null);
    } else {
      this._status.set('idle');
      if (this.initialized) {
        void this.syncNow();
      }
    }
  }

  private async loadLocalState(): Promise<void> {
    const checkedAt = (await this.engine.getSyncMeta(CATALOG_CHECKED_AT_KEY))?.value;
    if (checkedAt && !this._lastChecked()) {
      this._lastChecked.set(new Date(checkedAt));
    }
    await this.refreshStats();
  }

  private async refreshStats(): Promise<void> {
    this._stats.set(await this.engine.catalogStats());
  }

  private async runRepeatedly(): Promise<void> {
    do {
      this.rerunRequested = false;
      await this.run();
    } while (this.shouldRunAgain());
  }

  /** Read through a method so the compiler doesn't narrow `rerunRequested`, which syncNow() sets during a run. */
  private shouldRunAgain(): boolean {
    return this.rerunRequested && this._status() !== 'unauthorized' && navigator.onLine;
  }

  private async run(): Promise<void> {
    const epoch = this.epoch;
    this._status.set('checking');
    let outcome: CatalogSyncStatus = 'idle';
    try {
      await this.checkAndDownload(epoch);
    } catch (error: unknown) {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        outcome = 'unauthorized';
        // The session may have expired. A sync lets SyncService confirm it
        // and, if so, sign out properly (AuthService follows SyncService).
        void this.syncService.syncNow();
      } else if (!(error instanceof RunSuperseded)) {
        if (!(error instanceof HttpErrorResponse)) {
          console.error('catalog.sync_failed', error);
        }
        outcome = navigator.onLine ? 'error' : 'offline';
      }
    } finally {
      this._progress.set(null);
      await this.refreshStats().catch(() => undefined);
    }

    // A sign-in or sign-out during the run decides the status instead of
    // this run's outcome (and a signed-out status must stick, so no rerun).
    if (epoch !== this.epoch) {
      return;
    }
    this._status.set(this.signedOut() ? 'unauthorized' : outcome);
  }

  /** Read synchronously: the effect relaying sign-outs runs a moment later. */
  private signedOut(): boolean {
    return this.syncService.status() === 'unauthorized';
  }

  private async checkAndDownload(epoch: number): Promise<void> {
    const etag = (await this.engine.getSyncMeta(CATALOG_ETAG_KEY))?.value;
    const fetched = await this.fetchManifest(etag);
    this.ensureCurrent(epoch);

    if (fetched) {
      const { manifest, etag: newEtag } = fetched;
      await this.engine.replaceCatalogSeries(manifest.series);
      await this.applyManifest(manifest, epoch);
      if (newEtag) {
        await this.engine.putSyncMeta({ key: CATALOG_ETAG_KEY, value: newEtag });
      }
    }

    await this.syncPrices(epoch);

    const now = new Date();
    await this.engine.putSyncMeta({ key: CATALOG_CHECKED_AT_KEY, value: now.toISOString() });
    this._lastChecked.set(now);

    if ((await this.engine.catalogStats()).sets > 0) {
      await requestPersistentStorage();
    }
  }

  /** The manifest, or null when it's unchanged since `etag` (304). */
  private async fetchManifest(
    etag: string | undefined
  ): Promise<{ manifest: CatalogManifest; etag: string | null } | null> {
    try {
      const response = await firstValueFrom(
        this.http.get<CatalogManifest>(`${environment.apiUrl}/api/catalog/manifest`, {
          observe: 'response',
          headers: etag ? new HttpHeaders({ 'If-None-Match': etag }) : undefined,
        })
      );
      if (!response.body) {
        throw new Error('catalog.manifest_empty');
      }
      return { manifest: response.body, etag: response.headers.get('etag') };
    } catch (error: unknown) {
      if (error instanceof HttpErrorResponse && error.status === 304) {
        return null;
      }
      throw error;
    }
  }

  private async applyManifest(manifest: CatalogManifest, epoch: number): Promise<void> {
    const storedSets = await this.engine.listCatalogSets();
    const stored = new Map(storedSets.map((set) => [set.key, set.hash]));
    const listed = new Set(manifest.sets.map((set) => catalogKey(set.region, set.id)));

    for (const set of storedSets) {
      if (!listed.has(set.key)) {
        await this.engine.deleteCatalogSet(set.region, set.set.id);
        this._changed$.next();
      }
    }

    const missing = manifest.sets.filter(
      (set) => stored.get(catalogKey(set.region, set.id)) !== set.hash
    );
    if (missing.length === 0) {
      return;
    }

    this.ensureCurrent(epoch);
    this._status.set('downloading');
    this._progress.set({ done: 0, total: missing.length });
    await runPool(missing, CATALOG_DOWNLOAD_CONCURRENCY, async (set) => {
      this.ensureCurrent(epoch);
      const pack = await this.fetchPack(set, epoch);
      this.ensureCurrent(epoch);
      if (pack) {
        await this.engine.replaceCatalogSet(pack);
      } else if (stored.has(catalogKey(set.region, set.id))) {
        // Removed on the server since the manifest was fetched.
        await this.engine.deleteCatalogSet(set.region, set.id);
      }
      this._progress.update((progress) =>
        progress ? { ...progress, done: progress.done + 1 } : progress
      );
      this._changed$.next();
    });
  }

  /**
   * Stores the price pack of each region with sets on this device, unless
   * unchanged since its stored ETag (docs/catalog.md → Prices on the device).
   */
  private async syncPrices(epoch: number): Promise<void> {
    const regions = new Set((await this.engine.listCatalogSets()).map((set) => set.region));
    for (const region of CATALOG_REGIONS.filter((candidate) => regions.has(candidate))) {
      const key = catalogPricesEtagKey(region);
      const etag = (await this.engine.getSyncMeta(key))?.value;
      this.ensureCurrent(epoch);
      const response = await this.fetchWithRetries(
        `${environment.apiUrl}/api/catalog/prices/${region}`,
        epoch,
        etag
      );
      this.ensureCurrent(epoch);
      if (!response?.body) {
        continue; // Unchanged (304), or a server without prices yet (404).
      }
      await this.engine.replaceCatalogPrices(response.body as CatalogPricePack);
      const newEtag = response.headers.get('etag');
      if (newEtag) {
        await this.engine.putSyncMeta({ key, value: newEtag });
      }
    }
  }

  /** Fetches a set pack. Null when the set no longer exists (404). */
  private async fetchPack(set: CatalogManifestSet, epoch: number): Promise<CatalogSetPack | null> {
    const url = `${environment.apiUrl}/api/catalog/sets/${set.region}/${encodeURIComponent(set.id)}`;
    const response = await this.fetchWithRetries(url, epoch);
    return (response?.body as CatalogSetPack | null | undefined) ?? null;
  }

  /**
   * GETs `url`, waiting out rate limits and brief failures
   * (`CATALOG_PACK_ATTEMPTS`). Null for 404, and for 304 when `etag` was sent.
   */
  private async fetchWithRetries(
    url: string,
    epoch: number,
    etag?: string
  ): Promise<HttpResponse<unknown> | null> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await firstValueFrom(
          this.http.get<unknown>(url, {
            observe: 'response',
            headers: etag ? new HttpHeaders({ 'If-None-Match': etag }) : undefined,
          })
        );
      } catch (error: unknown) {
        if (error instanceof HttpErrorResponse && (error.status === 404 || error.status === 304)) {
          return null;
        }
        if (!isTransient(error) || attempt >= CATALOG_PACK_ATTEMPTS) {
          throw error;
        }
        await this.sleep(retryDelayMs(error, attempt));
        this.ensureCurrent(epoch);
      }
    }
  }

  /** Overridden in tests. */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  /** Stops a run overtaken by a sign-in or sign-out, before its next request or write. */
  private ensureCurrent(epoch: number): void {
    if (epoch !== this.epoch || this.signedOut()) {
      throw new RunSuperseded();
    }
  }
}

/**
 * Runs `task` over `items`, at most `concurrency` at a time. After a failure
 * no new items start; it rejects with the first failure once running tasks
 * have settled.
 */
async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  let failed = false;
  const worker = async (): Promise<void> => {
    for (let item = queue.shift(); item !== undefined && !failed; item = queue.shift()) {
      try {
        await task(item);
      } catch (error: unknown) {
        failed = true;
        throw error;
      }
    }
  };
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, items.length) }, worker)
  );
  const rejected = results.find((result) => result.status === 'rejected');
  if (rejected) {
    throw rejected.reason;
  }
}

/**
 * Asks the browser not to evict this site's storage (the catalog is ~100 MB).
 * Not needed in the iOS app, whose SQLite file is never evicted.
 */
async function requestPersistentStorage(): Promise<void> {
  if (isNativePlatform() || !('storage' in navigator)) {
    return;
  }
  try {
    if (!(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    // Best effort: the catalog simply re-downloads if the browser evicts it.
  }
}
