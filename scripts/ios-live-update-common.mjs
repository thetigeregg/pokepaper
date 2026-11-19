import { createHash, createPrivateKey, createSign } from 'node:crypto';

/**
 * Signing and manifest helpers for iOS OTA bundles (docs/ios.md -> OTA
 * updates), ported from go-gather. The app side lives in
 * src/app/core/services/live-update.logic.ts.
 */

/** SHA-256 of the bundle zip as lowercase hex (the plugin's checksum format). */
export function computeBundleChecksum(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * RSA-SHA256 signature of the whole zip, base64-encoded: what
 * @capawesome/capacitor-live-update verifies against the public key in
 * capacitor.config.ts.
 */
export function signBundleBuffer(buffer, privateKeyPem) {
  const signer = createSign('RSA-SHA256');
  signer.update(buffer);
  signer.end();
  return signer.sign(createPrivateKey(privateKeyPem), 'base64');
}

/** `v<semver>-b<build>`: unique per release and native build. */
export function buildIosLiveUpdateBundleId(semver, nativeBuildNumber) {
  const version = typeof semver === 'string' ? semver.trim() : '';
  const build = String(nativeBuildNumber ?? '').trim();
  if (version.length === 0) {
    throw new Error('semver is required to build an OTA bundle id');
  }
  if (!/^\d+$/.test(build)) {
    throw new Error(`The native build number must be a positive integer (got "${build}")`);
  }
  return `v${version}-b${build}`;
}

/** The manifest the app fetches from `<origin>/ota/ios/<build>/manifest.json`. */
export function buildIosLiveUpdateManifest({
  bundleId,
  semver,
  nativeBuildNumber,
  backendOrigin,
  zipName,
  checksum,
  signature,
}) {
  const build = String(nativeBuildNumber).trim();
  return {
    bundleId,
    semver: semver.trim(),
    nativeBuildNumber: build,
    url: `${backendOrigin}/ota/ios/${build}/${zipName}`,
    checksum,
    signature,
  };
}
