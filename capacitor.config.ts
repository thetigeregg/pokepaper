import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Verifies OTA web bundles (docs/ios.md -> OTA updates). The matching private
 * key signs bundles in CI and never enters the repository.
 */
const LIVE_UPDATE_PUBLIC_KEY_PATH = resolve(process.cwd(), 'config/ios-live-update-public.pem');

function readLiveUpdatePublicKey(): string {
  return readFileSync(LIVE_UPDATE_PUBLIC_KEY_PATH, 'utf8').trim();
}

const config: CapacitorConfig = {
  // App PROD's bundle ID. App DEV (`.dev`) overrides it in the Xcode project;
  // both are listed in edge/well-known/apple-app-site-association.
  appId: 'io.github.thetigeregg.poketcg',
  appName: 'PokePaper',
  webDir: 'www',
  plugins: {
    // Native HTTP for fetch/XHR: the app's origin is capacitor://localhost,
    // and the server sends no CORS headers (docs/auth.md).
    CapacitorHttp: {
      enabled: true,
    },
    CapacitorSQLite: {
      iosDatabaseLocation: 'Library/CapacitorDatabase',
      iosIsEncryption: false,
    },
    // Off: on `cap sync` the plugin would otherwise write the passkey domain
    // into the committed entitlements files. The entitlements read it from a
    // generated, gitignored xcconfig instead (docs/ios.md → Passkeys), and
    // the app passes the origin on each call (PasskeyClient).
    CapacitorPasskey: {
      autoShim: false,
    },
    // OTA web updates: the app checks for, downloads and stages bundles
    // itself (LiveUpdateService), so the plugin's own strategy is off. A
    // staged bundle that doesn't call ready() within readyTimeout ms is
    // rolled back to the previous one.
    LiveUpdate: {
      autoUpdateStrategy: 'none',
      readyTimeout: 10000,
      publicKey: readLiveUpdatePublicKey(),
    },
  },
};

export default config;
