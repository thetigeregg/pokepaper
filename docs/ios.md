# iOS app

PokePaper ships as a native iOS app through [Capacitor](https://capacitorjs.com/) 8. The same Angular build runs in the app's web view, with on-device SQLite storage (`SqliteStorageEngine`) in place of IndexedDB.

Status: the native shell, both Xcode targets and native passkey sign-in are in place. Planned next: TestFlight delivery, and possibly over-the-air web updates.

## Targets

`ios/App/App.xcodeproj` has two targets that share all code and web assets. Each target is installed as its own app, so both can sit on one device side by side.

| Target   | Bundle ID                           | Home screen name | Backend                                          |
| -------- | ----------------------------------- | ---------------- | ------------------------------------------------ |
| App DEV  | `io.github.thetigeregg.poketcg.dev` | PokePaper Dev    | Your Mac's dev server over the LAN (`ios-local`) |
| App PROD | `io.github.thetigeregg.poketcg`     | PokePaper        | The public deployment (`ios-prod`)               |

Both bundle IDs are listed in `edge/well-known/apple-app-site-association`, which allows both apps to use passkeys for the public domain ([Passkeys](#passkeys)).

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

Set `IOS_BACKEND_ORIGIN_PROD` in `.env` to the public origin (the server's `PUBLIC_ORIGIN`, https with no path). It's also where the passkey domain comes from ([Passkeys](#passkeys)). Then:

```bash
npm run sync:ios:prod
```

and run or archive the **App PROD** scheme.

Both targets bundle whatever was synced last (`ios/App/App/public`), and nothing in Xcode checks which build that was. Always run `sync:ios:prod` before running or archiving App PROD, and `sync:ios:local` before App DEV. Otherwise App PROD ships pointed at your LAN, or App DEV talks to production data. CI checks that the `ios-prod` Angular build still compiles (`ios_prod_build_validation` in `ci-pr.yml`). There are no Xcode builds in CI yet.

## Passkeys

The app signs in with the same passkeys as the web app (iCloud Keychain syncs them), but it can't use WebAuthn in its web view: the web view's origin is `capacitor://localhost`, not the server's domain. Instead:

- **Ceremony:** `PasskeyClient` (`src/app/core/auth/passkey-client.ts`) hands the server's WebAuthn options to [`@capgo/capacitor-passkey`](https://github.com/Cap-go/capacitor-passkey), which runs the ceremony with AuthenticationServices and returns the WebAuthn JSON the server already verifies. In browsers the same class uses SimpleWebAuthn.
- **Origin:** the app passes `apiUrl` (the public origin) as the ceremony's origin. On iOS 17.4 and later that's what lands in `clientDataJSON`. Earlier versions use `https://<RP ID>`. Either way it must equal the server's `PUBLIC_ORIGIN`, so keep `IOS_BACKEND_ORIGIN_PROD` identical to it.
- **Associated domain:** iOS only lets an app use passkeys for a domain that lists the app in its `apple-app-site-association` file (served by `edge`, fetched by Apple's CDN) and that the app names in its `com.apple.developer.associated-domains` entitlement. App PROD's entitlements say `webcredentials:$(PASSKEY_DOMAIN)`. App DEV has none: it only talks to a LAN server, where passkeys can't work anyway, and so it builds without the capability (personal signing teams don't support it).
- **`PASSKEY_DOMAIN`:** `ios/debug.xcconfig` and `ios/release.xcconfig` include the gitignored `ios/passkey.xcconfig`, which `write-environment-ios.mjs` generates on every build. It holds the host of `IOS_BACKEND_ORIGIN_PROD`, or `IOS_PASSKEY_DOMAIN` if the server sets a different `RP_ID`. This keeps the real domain out of the repository. The plugin's own `cap sync` hook, which would write the domain into the entitlements, is turned off (`autoShim: false` in `capacitor.config.ts`).
- **Session token:** the app signs in as `client: 'ios'`, so the server returns the session as a bearer token instead of a cookie ([`auth.md`](auth.md) → Sessions). `AuthTokenStore` keeps it in the Keychain ([`capacitor-secure-storage-plugin`](https://github.com/martinkasa/capacitor-secure-storage-plugin)), and `authTokenInterceptor` sends it as `Authorization: Bearer …`, only on requests to `apiUrl`.
  - If the Keychain can't be read (a launch before the device's first unlock), requests fail like network errors and are retried. A request sent without the token would get a 401 and sign you out.
  - A sign-out the server can't confirm signs the app out right away and moves the token to a separate Keychain entry, used only to revoke it on the server later. That entry survives a reinstall and later sign-ins, which Preferences don't.
  - If the Keychain write fails after sign-in, the app revokes the new session instead of leaving it behind.

To sign in on a device, build App PROD (`npm run sync:ios:prod`) with your team selected. Automatic signing adds the Associated Domains capability to the App ID. That needs a paid Apple Developer team. A LAN build (App DEV with `sync:ios:local`) talks to a server whose relying party is `localhost`, so it can't use passkeys. Use `AUTH_DEV_BYPASS` there, as described in [Local development](#local-development).

## How the build fits together

| Script                             | What it does                                                                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build:ios:local` / `prod` | `ng build` with the `ios-local` / `ios-prod` configuration: no service worker, and `environment.ts` replaced by the generated `environment.ios.*.ts`  |
| `npm run sync:ios:local` / `prod`  | The build above, then `npx cap sync ios` (copies `www/` into `ios/App/App/public` and updates `CapApp-SPM`)                                           |
| `prebuild:ios:local` / `prod`      | Runs automatically before each build: writes the environment file and `ios/passkey.xcconfig`, then `prebuild:ios`                                     |
| `prebuild:ios`                     | Sets `MARKETING_VERSION` from `package.json`, then regenerates the Info.plists                                                                        |
| `npm run generate:ios-info-plists` | Merges `Info.shared.plist` with each target's overlay into the committed `Info.dev.plist` / `Info.prod.plist`. A script test fails if those are stale |
| `npm run sync:ios:version`         | `--marketing-only` sets every target's version; `--build-number N` sets App PROD's version and build number (for TestFlight)                          |

- **Environment files:** `scripts/write-environment-ios.mjs` writes `src/environments/environment.ios.local.ts` / `environment.ios.prod.ts` (gitignored). `apiUrl` is the backend origin, and the app puts it in front of every `/api` and `/images` request. The web build keeps `apiUrl: ''`, since `edge` serves the app and API from one origin.
- **Info.plist:** edit `Info.shared.plist` or a target's `Info.*.overlay.plist`, never the generated `Info.dev.plist` / `Info.prod.plist`. Then run `npm run generate:ios-info-plists`.
- **Versions:** releases bump `package.json` only, and builds copy that version into the Xcode project. So `MARKETING_VERSION` in `project.pbxproj` can lag behind in git. Don't commit a local bump made by a build.
- **Native HTTP:** `capacitor.config.ts` enables `CapacitorHttp`, so `fetch` and `HttpClient` requests go through native networking. The app's origin is `capacitor://localhost`, and the server sends no CORS headers.
- **Generated files:** `ios/App/App/public`, `capacitor.config.json` and `config.xml` come from `npx cap sync`, and `ios/passkey.xcconfig` from the prebuild. All are gitignored (`ios/.gitignore`).
