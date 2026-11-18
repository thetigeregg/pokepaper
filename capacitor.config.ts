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
  },
};

export default config;
