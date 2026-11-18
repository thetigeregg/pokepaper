import type { CapacitorConfig } from '@capacitor/cli';

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
  },
};

export default config;
