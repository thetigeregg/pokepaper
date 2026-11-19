import {
  buildLiveUpdateManifestUrl,
  isBundleAlreadyDownloadedError,
  parseIosLiveUpdateManifest,
  resolveBackendOriginFromApiUrl,
  shouldStageLiveUpdateManifest,
  withManifestCacheBuster,
  type IosLiveUpdateManifest,
} from './live-update.logic';

const ORIGIN = 'https://pokepaper.example.com';

const manifest: IosLiveUpdateManifest = {
  bundleId: 'v0.17.0-b3',
  semver: '0.17.0',
  nativeBuildNumber: '3',
  url: `${ORIGIN}/ota/ios/3/v0.17.0-b3.zip`,
  checksum: 'abc',
  signature: 'sig',
};

describe('live-update logic', () => {
  describe('parseIosLiveUpdateManifest', () => {
    it('accepts a complete manifest, trimming fields', () => {
      expect(parseIosLiveUpdateManifest({ ...manifest, semver: ' 0.17.0 ' }, ORIGIN)).toEqual(
        manifest
      );
    });

    it('rejects non-objects and missing or empty fields', () => {
      expect(parseIosLiveUpdateManifest(null, ORIGIN)).toBeNull();
      expect(parseIosLiveUpdateManifest('manifest', ORIGIN)).toBeNull();
      for (const key of Object.keys(manifest) as (keyof IosLiveUpdateManifest)[]) {
        expect(parseIosLiveUpdateManifest({ ...manifest, [key]: '  ' }, ORIGIN)).toBeNull();
        expect(parseIosLiveUpdateManifest({ ...manifest, [key]: 3 }, ORIGIN)).toBeNull();
      }
    });

    it('only accepts bundles served over https from the backend origin', () => {
      for (const url of [
        'http://pokepaper.example.com/ota/ios/3/b.zip',
        'https://evil.example.com/ota/ios/3/b.zip',
        'https://pokepaper.example.com.evil.test/b.zip',
        'not a url',
      ]) {
        expect(parseIosLiveUpdateManifest({ ...manifest, url }, ORIGIN)).toBeNull();
      }
    });
  });

  describe('shouldStageLiveUpdateManifest', () => {
    const base = { manifest, nativeBuildNumber: '3', currentBundleId: null, nextBundleId: null };

    it('stages a new bundle for this native build', () => {
      expect(shouldStageLiveUpdateManifest(base)).toEqual({
        shouldStage: true,
        reason: 'update_available',
      });
    });

    it('explains why it skips', () => {
      expect(shouldStageLiveUpdateManifest({ ...base, manifest: null }).reason).toBe(
        'invalid_manifest'
      );
      expect(shouldStageLiveUpdateManifest({ ...base, nativeBuildNumber: ' ' }).reason).toBe(
        'missing_native_build_number'
      );
      expect(shouldStageLiveUpdateManifest({ ...base, nativeBuildNumber: '4' }).reason).toBe(
        'native_build_mismatch'
      );
      expect(shouldStageLiveUpdateManifest({ ...base, currentBundleId: 'v0.17.0-b3' }).reason).toBe(
        'already_staged_or_active'
      );
      expect(shouldStageLiveUpdateManifest({ ...base, nextBundleId: 'v0.17.0-b3' }).reason).toBe(
        'already_staged_or_active'
      );
      expect(
        shouldStageLiveUpdateManifest({ ...base, blockedBundleIds: ['v0.16.0-b3', 'v0.17.0-b3'] })
          .reason
      ).toBe('rolled_back');
    });
  });

  it('recognizes the plugin error for an already-downloaded bundle', () => {
    expect(isBundleAlreadyDownloadedError(new Error('Bundle already exists.'))).toBe(true);
    expect(isBundleAlreadyDownloadedError(new Error('Network error'))).toBe(false);
    expect(isBundleAlreadyDownloadedError('Bundle already exists')).toBe(false);
  });

  it('builds the per-build manifest URL with a cache-buster', () => {
    expect(buildLiveUpdateManifestUrl(`${ORIGIN}/`, ' 3 ')).toBe(
      `${ORIGIN}/ota/ios/3/manifest.json`
    );
    expect(withManifestCacheBuster(`${ORIGIN}/ota/ios/3/manifest.json`, 42)).toBe(
      `${ORIGIN}/ota/ios/3/manifest.json?t=42`
    );
  });

  it('resolves the https backend origin from apiUrl', () => {
    expect(resolveBackendOriginFromApiUrl('https://PokePaper.example.com')).toBe(ORIGIN);
    expect(resolveBackendOriginFromApiUrl('')).toBeNull();
    expect(resolveBackendOriginFromApiUrl('http://192.168.1.50:3000')).toBeNull();
    expect(resolveBackendOriginFromApiUrl('not a url')).toBeNull();
  });
});
