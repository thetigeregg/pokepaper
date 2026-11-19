import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { App } from '@capacitor/app';
import { LiveUpdate } from '@capawesome/capacitor-live-update';
import { firstValueFrom, ReplaySubject, timeout, type Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { WITHOUT_SESSION_TOKEN } from '../auth/auth-token.interceptor';
import { isNativePlatform } from '../utils/native-platform.util';
import {
  buildLiveUpdateManifestUrl,
  isBundleAlreadyDownloadedError,
  parseIosLiveUpdateManifest,
  resolveBackendOriginFromApiUrl,
  shouldStageLiveUpdateManifest,
  withManifestCacheBuster,
  type IosLiveUpdateManifest,
} from './live-update.logic';

const MANIFEST_FETCH_TIMEOUT_MS = 8000;
const RESUME_CHECK_INTERVAL_MS = 15 * 60 * 1000;

/**
 * OTA web updates for the iOS app (docs/ios.md -> OTA updates), ported from
 * go-gather. Only App PROD builds (native + production) check: on launch,
 * then on resume at most every 15 minutes. A compatible new bundle is
 * downloaded (the plugin verifies its signature against the public key in
 * capacitor.config.ts) and staged as the next bundle; `staged$` then lets the
 * app offer to reload now. Otherwise it applies on the next cold start.
 *
 * Nothing here may block startup or throw: the native bridge calls have no
 * timeout of their own, and the app must open offline. `start()` runs from an
 * app initializer without being awaited.
 */
@Injectable({ providedIn: 'root' })
export class LiveUpdateService {
  private readonly http = inject(HttpClient);

  private resumeListenerAttached = false;
  /** When a check last reached the server (a manifest or a 404). */
  private lastCheckAt = 0;
  private checkInFlight: Promise<void> | null = null;
  /** CFBundleVersion: constant while the app runs. */
  private versionCode: string | null = null;

  // Replays: the launch check can stage a bundle before AppComponent subscribes.
  private readonly stagedSubject = new ReplaySubject<{ semver: string }>(1);
  /** Emits after a new bundle has been downloaded and staged. */
  readonly staged$: Observable<{ semver: string }> = this.stagedSubject.asObservable();

  isEnabled(): boolean {
    return isNativePlatform() && environment.production;
  }

  /**
   * Startup: confirms this bundle first, before slower startup work (storage
   * migrations, the Keychain) can run past the rollback timeout, and so a
   * rollback is recorded before the first check could re-stage that bundle.
   * Then checks for an update and watches for resumes.
   */
  async start(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }
    await this.markReady();
    this.initializeResumeChecks();
    await this.checkAndStageUpdate(true);
  }

  /**
   * Checks the manifest and stages a new bundle if there is one. `force`
   * skips the resume throttle and waits out a check already in flight.
   */
  async checkAndStageUpdate(force = false): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    while (this.checkInFlight !== null) {
      if (!force) {
        return this.checkInFlight;
      }
      await this.checkInFlight;
    }

    const check = this.runCheckAndStageUpdate(force).finally(() => {
      if (this.checkInFlight === check) {
        this.checkInFlight = null;
      }
    });
    this.checkInFlight = check;
    return check;
  }

  /**
   * Tells the plugin this bundle started fine. Without it, a newly applied
   * bundle is rolled back after `readyTimeout` and blocked
   * (capacitor.config.ts).
   */
  async markReady(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }
    try {
      const result = await LiveUpdate.ready();
      const details = {
        currentBundleId: result.currentBundleId ?? null,
        previousBundleId: result.previousBundleId ?? null,
        rollback: result.rollback,
      };
      if (result.rollback) {
        // The previous bundle failed to start; the plugin has blocked it.
        console.error('live_update.rolled_back', details);
      } else {
        console.info('live_update.ready', details);
      }
    } catch (error: unknown) {
      console.error('live_update.ready_failed', describe(error));
    }
  }

  /** Checks again whenever the app returns to the foreground (throttled). */
  initializeResumeChecks(): void {
    if (!this.isEnabled() || this.resumeListenerAttached) {
      return;
    }
    this.resumeListenerAttached = true;
    App.addListener('appStateChange', (state) => {
      if (state.isActive) {
        void this.checkAndStageUpdate();
      }
    }).catch((error: unknown) => {
      this.resumeListenerAttached = false;
      console.error('live_update.resume_listener_failed', describe(error));
    });
  }

  /** Applies the staged bundle now by reloading the web view. */
  async reload(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }
    try {
      await LiveUpdate.reload();
    } catch (error: unknown) {
      console.error('live_update.reload_failed', describe(error));
    }
  }

  private async runCheckAndStageUpdate(force: boolean): Promise<void> {
    if (!force && Date.now() - this.lastCheckAt < RESUME_CHECK_INTERVAL_MS) {
      return;
    }

    try {
      this.versionCode ??= (await LiveUpdate.getVersionCode()).versionCode.trim();
      const versionCode = this.versionCode;
      const backendOrigin = resolveBackendOriginFromApiUrl(environment.apiUrl);
      if (versionCode.length === 0 || backendOrigin === null) {
        console.info('live_update.skip_unconfigured', {
          hasVersionCode: versionCode.length > 0,
          hasBackendOrigin: backendOrigin !== null,
        });
        return;
      }

      const manifest = await this.fetchManifest(backendOrigin, versionCode);
      // Throttle only checks that reached the server: after a failure
      // (offline, timeout) the next resume tries again.
      this.lastCheckAt = Date.now();
      if (manifest === null) {
        return;
      }

      const [current, next, blocked] = await Promise.all([
        LiveUpdate.getCurrentBundle(),
        LiveUpdate.getNextBundle(),
        LiveUpdate.getBlockedBundles(),
      ]);
      const decision = shouldStageLiveUpdateManifest({
        manifest,
        nativeBuildNumber: versionCode,
        currentBundleId: current.bundleId ?? null,
        nextBundleId: next.bundleId ?? null,
        blockedBundleIds: blocked.bundleIds,
      });
      if (!decision.shouldStage) {
        console.info('live_update.skip', { reason: decision.reason });
        return;
      }

      try {
        await LiveUpdate.downloadBundle({
          url: manifest.url,
          bundleId: manifest.bundleId,
          checksum: manifest.checksum,
          signature: manifest.signature,
        });
      } catch (error: unknown) {
        if (!isBundleAlreadyDownloadedError(error)) {
          throw error;
        }
        console.info('live_update.bundle_already_downloaded', { bundleId: manifest.bundleId });
      }

      await LiveUpdate.setNextBundle({ bundleId: manifest.bundleId });
      console.info('live_update.staged', {
        bundleId: manifest.bundleId,
        semver: manifest.semver,
        nativeBuildNumber: manifest.nativeBuildNumber,
      });
      this.stagedSubject.next({ semver: manifest.semver });
    } catch (error: unknown) {
      console.error('live_update.check_failed', describe(error));
    }
  }

  /** The manifest for this native build, or null when there's none (404) or it's unusable. */
  private async fetchManifest(
    backendOrigin: string,
    nativeBuildNumber: string
  ): Promise<IosLiveUpdateManifest | null> {
    const manifestUrl = withManifestCacheBuster(
      buildLiveUpdateManifestUrl(backendOrigin, nativeBuildNumber),
      Date.now()
    );

    let payload: unknown;
    try {
      payload = await firstValueFrom(
        this.http
          // A public static file: no session token, no wait on the Keychain.
          .get<unknown>(manifestUrl, {
            context: new HttpContext().set(WITHOUT_SESSION_TOKEN, true),
          })
          .pipe(timeout(MANIFEST_FETCH_TIMEOUT_MS))
      );
    } catch (error: unknown) {
      if (error instanceof HttpErrorResponse && error.status === 404) {
        // No bundle published for this native build: nothing to do.
        return null;
      }
      throw error;
    }

    const manifest = parseIosLiveUpdateManifest(payload, backendOrigin);
    if (manifest === null) {
      console.error('live_update.manifest_invalid', { manifestUrl });
    }
    return manifest;
  }
}

function describe(error: unknown): { error: string } {
  return { error: error instanceof Error ? error.message : String(error) };
}
