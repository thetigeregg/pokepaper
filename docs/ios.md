# iOS app

PokePaper ships as a native iOS app through [Capacitor](https://capacitorjs.com/) 8. The same Angular build runs in the app's web view, with on-device SQLite storage (`SqliteStorageEngine`) in place of IndexedDB.

Status: the native shell, its build scripts and both Xcode targets are in place. Planned next: native passkey sign-in with a Keychain-stored bearer token, TestFlight delivery, and possibly over-the-air web updates.

## Targets

`ios/App/App.xcodeproj` has two targets that share all code and web assets. Each target is installed as its own app, so both can sit on one device side by side.

| Target   | Bundle ID                           | Home screen name | Backend                                          |
| -------- | ----------------------------------- | ---------------- | ------------------------------------------------ |
| App DEV  | `io.github.thetigeregg.poketcg.dev` | PokePaper Dev    | Your Mac's dev server over the LAN (`ios-local`) |
| App PROD | `io.github.thetigeregg.poketcg`     | PokePaper        | The public deployment (`ios-prod`)               |

Both bundle IDs are listed in `edge/well-known/apple-app-site-association`, which allows both apps to use passkeys for the public domain. Native passkey sign-in isn't wired up yet.

App DEV has a red "DEV" band on its icon and an App Transport Security exception for plain-HTTP local networking. Both icons are generated from the placeholder `public/favicon.svg` mark. Plugins come in through Swift Package Manager (`ios/App/CapApp-SPM`, managed by `npx cap sync`), so there's no CocoaPods step.

## Prerequisites

- Xcode with an iOS simulator, or a device with Developer Mode on
- For a device: your Apple developer team selected under Signing & Capabilities (both targets use automatic signing)

## Local development

1. Run the server on all interfaces, with the dev auth bypass. Passkeys need the real HTTPS domain, so a LAN build can't sign in ([`auth.md`](auth.md) → Local development):

   ```bash
   AUTH_DEV_BYPASS=true npm run start:server
   ```

2. Build the web app against your Mac's LAN address and copy it into the Xcode project:

   ```bash
   npm run sync:ios:local
   ```

   The LAN IP is auto-detected (preferring `en0`). If it picks the wrong interface (a VPN, say), set `IOS_LAN_HOST` or `IOS_BACKEND_ORIGIN_LOCAL` in `.env` (see `.env.example`). The app talks straight to the server on port 3000, without `edge` or the `ng serve` proxy.

3. Open Xcode with `npx cap open ios`, choose the **App DEV** scheme, and run it.

   On first launch on a device, iOS asks for local network access. Allow it, or the app can't reach your Mac.

Re-run `npm run sync:ios:local` after every web change. Native-only changes (Swift, plists, assets) just need a rebuild in Xcode.

## Production build

Set `IOS_BACKEND_ORIGIN_PROD` in `.env` to the public origin (the server's `PUBLIC_ORIGIN`, https with no path), then:

```bash
npm run sync:ios:prod
```

and run or archive the **App PROD** scheme. CI checks that the `ios-prod` Angular build still compiles (`ios_prod_build_validation` in `ci-pr.yml`). There are no Xcode builds in CI yet.

## How the build fits together

| Script                             | What it does                                                                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build:ios:local` / `prod` | `ng build` with the `ios-local` / `ios-prod` configuration: no service worker, and `environment.ts` replaced by the generated `environment.ios.*.ts`        |
| `npm run sync:ios:local` / `prod`  | The build above, then `npx cap sync ios` (copies `www/` into `ios/App/App/public` and updates `CapApp-SPM`)                                                 |
| `prebuild:ios:local` / `prod`      | Runs automatically before each build: writes the environment file, then `prebuild:ios`                                                                      |
| `prebuild:ios`                     | Sets `MARKETING_VERSION` from `package.json`, then regenerates the Info.plists                                                                              |
| `npm run generate:ios-info-plists` | Merges `Info.shared.plist` with each target's overlay into the committed `Info.dev.plist` / `Info.prod.plist`. A script test fails if those are stale       |
| `npm run sync:ios:version`         | `--marketing-only` sets every target's version; `--build-number N` sets App PROD's version and build number (for TestFlight); `--check` fails on a mismatch |

- **Environment files:** `scripts/write-environment-ios.mjs` writes `src/environments/environment.ios.local.ts` / `environment.ios.prod.ts` (gitignored). `apiUrl` is the backend origin, and the app puts it in front of every `/api` and `/images` request. The web build keeps `apiUrl: ''`, since `edge` serves the app and API from one origin.
- **Info.plist:** edit `Info.shared.plist` or a target's `Info.*.overlay.plist`, never the generated `Info.dev.plist` / `Info.prod.plist`. Then run `npm run generate:ios-info-plists`.
- **Versions:** releases bump `package.json` only, and builds copy that version into the Xcode project. So `MARKETING_VERSION` in `project.pbxproj` can lag behind in git. Don't commit a local bump made by a build.
- **Native HTTP:** `capacitor.config.ts` enables `CapacitorHttp`, so `fetch` and `HttpClient` requests go through native networking. The app's origin is `capacitor://localhost`, and the server sends no CORS headers.
- **Generated files:** `ios/App/App/public`, `capacitor.config.json` and `config.xml` come from `npx cap sync` and are gitignored (`ios/.gitignore`).
