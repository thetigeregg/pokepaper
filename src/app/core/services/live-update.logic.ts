/**
 * Pure logic for iOS OTA web updates (docs/ios.md -> OTA updates), ported from
 * go-gather. The manifest format matches what the release pipeline publishes
 * at `/ota/ios/<nativeBuildNumber>/manifest.json`.
 */

export interface IosLiveUpdateManifest {
  bundleId: string;
  semver: string;
  /** The native build (CFBundleVersion) this bundle was built for. */
  nativeBuildNumber: string;
  /** Where to download the signed zip. */
  url: string;
  checksum: string;
  signature: string;
}

export type LiveUpdateStageDecisionReason =
  | 'invalid_manifest'
  | 'missing_native_build_number'
  | 'native_build_mismatch'
  | 'already_staged_or_active'
  | 'update_available';

export interface LiveUpdateStageDecision {
  shouldStage: boolean;
  reason: LiveUpdateStageDecisionReason;
}

/**
 * The manifest, or null if any field is missing or the bundle URL isn't https
 * on `backendOrigin`. (The plugin verifies the zip's signature regardless;
 * this keeps the app from downloading from anywhere else.)
 */
export function parseIosLiveUpdateManifest(
  value: unknown,
  backendOrigin: string
): IosLiveUpdateManifest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<Record<keyof IosLiveUpdateManifest, unknown>>;
  const field = (key: keyof IosLiveUpdateManifest): string => {
    const raw = candidate[key];
    return typeof raw === 'string' ? raw.trim() : '';
  };
  const manifest: IosLiveUpdateManifest = {
    bundleId: field('bundleId'),
    semver: field('semver'),
    nativeBuildNumber: field('nativeBuildNumber'),
    url: field('url'),
    checksum: field('checksum'),
    signature: field('signature'),
  };

  const fields: string[] = [
    manifest.bundleId,
    manifest.semver,
    manifest.nativeBuildNumber,
    manifest.url,
    manifest.checksum,
    manifest.signature,
  ];
  if (fields.some((entry) => entry.length === 0)) {
    return null;
  }

  try {
    const bundleUrl = new URL(manifest.url);
    if (bundleUrl.protocol !== 'https:' || bundleUrl.origin !== backendOrigin) {
      return null;
    }
  } catch {
    return null;
  }

  return manifest;
}

export function shouldStageLiveUpdateManifest(options: {
  manifest: IosLiveUpdateManifest | null;
  nativeBuildNumber: string | null;
  currentBundleId: string | null;
  nextBundleId: string | null;
}): LiveUpdateStageDecision {
  const { manifest, nativeBuildNumber, currentBundleId, nextBundleId } = options;

  if (manifest === null) {
    return { shouldStage: false, reason: 'invalid_manifest' };
  }

  const deviceBuild = nativeBuildNumber?.trim() ?? '';
  if (deviceBuild.length === 0) {
    return { shouldStage: false, reason: 'missing_native_build_number' };
  }

  if (manifest.nativeBuildNumber !== deviceBuild) {
    return { shouldStage: false, reason: 'native_build_mismatch' };
  }

  if (manifest.bundleId === currentBundleId || manifest.bundleId === nextBundleId) {
    return { shouldStage: false, reason: 'already_staged_or_active' };
  }

  return { shouldStage: true, reason: 'update_available' };
}

/**
 * `LiveUpdate.downloadBundle()` throws this when a bundle with that ID is
 * already on disk; it never re-links an existing bundle. Without this check,
 * a bundle downloaded but never staged (an interrupted check, or a native
 * version change resetting the pointers) would fail every later check.
 */
export function isBundleAlreadyDownloadedError(error: unknown): boolean {
  return error instanceof Error && /bundle already exists/i.test(error.message);
}

export function buildLiveUpdateManifestUrl(
  backendOrigin: string,
  nativeBuildNumber: string
): string {
  return `${backendOrigin.replace(/\/+$/, '')}/ota/ios/${encodeURIComponent(nativeBuildNumber.trim())}/manifest.json`;
}

/**
 * Appends `?t=<cacheBuster>`. Native HTTP goes through iOS's URLSession, which
 * can replay a cached response for the plain URL from disk; a unique query
 * string per check always reaches the server.
 */
export function withManifestCacheBuster(manifestUrl: string, cacheBuster: string | number): string {
  return `${manifestUrl}?t=${encodeURIComponent(String(cacheBuster))}`;
}

/** The https origin of `apiUrl` (the public origin in prod builds), or null. */
export function resolveBackendOriginFromApiUrl(apiUrl: string): string | null {
  if (apiUrl.trim().length === 0) {
    return null;
  }

  try {
    const parsed = new URL(apiUrl.trim());
    return parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}
