# PokePaper

PokePaper is a one-user Ionic + Angular app for the Pokémon Trading Card Game:

- Browse every card from every series and set
- Track which cards you own
- Build decks
- Read cards in other languages

It runs as a web app and as a native iOS app (Capacitor). It works offline: data lives on the device and syncs when online. It's served on the public internet behind passkey-only authentication ([`docs/auth.md`](docs/auth.md)).

> **Status:** in use. The infrastructure phases are complete (tooling → app shell → server → passkey auth → Docker/deploy → CI/CD → iOS, with native passkey sign-in, TestFlight delivery and OTA web updates: [`docs/ios.md`](docs/ios.md)). The app covers the card catalog with search ([`docs/catalog.md`](docs/catalog.md)), collection tracking ([`docs/collection.md`](docs/collection.md)) and deck building with format rules and owned vs. needed ([`docs/decks.md`](docs/decks.md)).

## Repository Structure

- `src/`: frontend app (Ionic/Angular, web + Capacitor iOS)
- `shared/`: domain and sync wire types shared by the frontend and server (`@pokepaper/shared`, npm workspace)
- `scripts/`: Node tooling (devx worktree adapter; iOS build/version/environment scripts), each with `*.test.mjs` tests
- `public/`: static web assets (favicon, web app manifest)
- `server/`: Fastify API with SQLite storage: passkey auth, sync, health, card catalog, and image cache (npm workspace)
- `edge/`: Caddy container serving the web app, proxying `/api` to `server`, serving the iOS app-association file, and setting security headers (CSP, HSTS, …)
- `ios/`: Capacitor iOS project with App DEV / App PROD targets ([`docs/ios.md`](docs/ios.md))
- `docs/`: [`auth.md`](docs/auth.md) (passkeys, sessions, setup, recovery), [`sync.md`](docs/sync.md) (sync rules), [`collection.md`](docs/collection.md) (collection tracking), [`decks.md`](docs/decks.md) (deck building), [`nas-deployment.md`](docs/nas-deployment.md) (Docker, Nginx Proxy Manager, Cloudflare), [`ios.md`](docs/ios.md) (Xcode targets, iOS builds, native passkeys, TestFlight, OTA updates)
- `.github/`: CI, release/publish, CodeQL, secret-scanning, and Claude workflows; PR/issue templates; Dependabot

## Prerequisites

- Node.js `24.22.3` (see `.nvmrc`)
- npm

## Local Development

1. Install dependencies (npm workspaces: installs the root app, `server/`, and `shared/` together):

```bash
npm ci
```

2. Run the frontend dev server:

```bash
npm start
```

3. Run the API server (separate terminal). The setup token lets you create the first passkey:

```bash
SETUP_TOKEN=dev-setup-token-0123456789 npm run start:server
```

The app opens at `http://localhost:4200`. `ng serve` proxies `/api` and `/images` to `http://127.0.0.1:3000` (`proxy.conf.json`), so the app and API share one origin in dev, matching production behind `edge`. On first launch the app shows the sign-in screen: enter the setup token and create a passkey (Chrome DevTools → WebAuthn can emulate an authenticator). See [`docs/auth.md`](docs/auth.md) → Local development. Once signed in, everything works from local storage even with the server stopped.

> Port 3000 is a common default. If another local project already listens on `127.0.0.1:3000`, the PokePaper server can still bind `0.0.0.0:3000` while the proxy reaches the other project. Free the port, or run the server with `PORT=3001 npm run start:server` and point `proxy.conf.json` at it.

## Server

Fastify 5 + better-sqlite3, run with `tsx` (no build step). It stores data in `server/data/pokepaper.db` (WAL mode) and applies the checksummed migrations in `server/src/migrations/` on startup. The card catalog, imported from TCGdex on a schedule, lives separately in `server/data/catalog.db` ([`docs/catalog.md`](docs/catalog.md)).

| Route                 | Purpose                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`     | 200 `{ status: 'ok', clientIp }` when the database answers, else 503. `clientIp` is the address you're rate-limited as (checks the proxy chain) |
| `POST /api/sync/push` | Apply queued client operations (idempotent, last-writer-wins)                                                                                   |
| `POST /api/sync/pull` | Page through the compacted change log from a cursor                                                                                             |
| `/api/auth/*`         | Passkey setup, sign-in, sign-out, passkey and device management ([`docs/auth.md`](docs/auth.md))                                                |
| `/api/catalog/*`      | Card catalog manifest and per-set packs ([`docs/catalog.md`](docs/catalog.md))                                                                  |
| `/images/catalog/*`   | Card scans and set logos, cached from TCGdex on first request                                                                                   |

Every route except health, auth status, and the passkey ceremonies requires a session.

Configuration (environment variables, all optional):

| Variable                | Default            | Purpose                                                                                                                                                                                                    |
| ----------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HOST` / `PORT`         | `0.0.0.0` / `3000` | Listen address                                                                                                                                                                                             |
| `DATA_DIR`              | `server/data`      | SQLite database directory                                                                                                                                                                                  |
| `BACKUP_DIR`            | `server/backups`   | `VACUUM INTO` snapshots                                                                                                                                                                                    |
| `BACKUP_KEEP`           | `14`               | Snapshots retained                                                                                                                                                                                         |
| `BACKUP_INTERVAL_HOURS` | `24`               | Backup schedule. A backup also runs at startup unless the newest snapshot is younger than the interval (so restart loops can't rotate good snapshots out); `0` = startup only                              |
| `TRUST_PROXY_HOPS`      | `0`                | Number of reverse proxies whose `X-Forwarded-*` headers to trust. Never "trust all": that would let clients choose their own IP                                                                            |
| `CLIENT_IP_HEADER`      | _(unset)_          | Header holding the real client IP for rate limiting, e.g. `cf-connecting-ip` behind Cloudflare (Cloudflare overwrites it, so clients can't spoof it). Falls back to the connection IP when unset or absent |
| `RATE_LIMIT_PER_MINUTE` | `600`              | Requests per client IP per minute, across all routes (429 beyond)                                                                                                                                          |
| `LOG_LEVEL`             | `info`             | pino log level                                                                                                                                                                                             |

Auth settings (`PUBLIC_ORIGIN`, `RP_ID`, `SESSION_TTL_DAYS`, `SETUP_TOKEN_FILE`, …) are listed in [`docs/auth.md`](docs/auth.md) → Configuration, and catalog settings (`CATALOG_LANGUAGES`, `CATALOG_REFRESH_HOURS`, …) in [`docs/catalog.md`](docs/catalog.md) → Configuration. Set `NODE_ENV=production` in production: it requires an https `PUBLIC_ORIGIN` and refuses `AUTH_DEV_BYPASS`.

Invalid values fail startup with a clear error. Backups use SQLite's online backup API, so the server keeps serving while a snapshot is written; each snapshot gets a fresh sync epoch, so restoring one makes clients re-sync from scratch (see [`docs/sync.md`](docs/sync.md)).

## App Architecture

- **Local-first storage.** All structured data goes through the `StorageEngine` interface (`src/app/core/data/`): Dexie/IndexedDB on the web, `@capacitor-community/sqlite` on iOS. Both engines run the same contract test suite.
- **Sync.** Writes update local storage and queue an outbox entry in one transaction. `SyncService` pushes the outbox to `POST /api/sync/push` and pulls the server change log from `POST /api/sync/pull` on startup, every 30 seconds, when the browser comes back online, and after each local write. A 401 pauses sync (outbox kept) until the user signs in again. Conflict rules and the server contract are in [`docs/sync.md`](docs/sync.md).
- **Offline web shell.** Production web builds register an Angular service worker (`ngsw-config.json`) so the app opens with no signal. iOS builds don't need it: the bundle ships inside the app.

UI conventions (layout, lists, actions, language, mobile and desktop parity) are in [`docs/ui.md`](docs/ui.md).

## iOS App

The Capacitor project in `ios/` has two Xcode targets, **App DEV** (`io.github.thetigeregg.poketcg.dev`, pointed at your Mac's dev server) and **App PROD** (`io.github.thetigeregg.poketcg`, pointed at the public deployment):

```bash
AUTH_DEV_BYPASS=true npm run start:server   # LAN builds can't use passkeys
npm run sync:ios:local                      # web build against your LAN IP + npx cap sync
npx cap open ios                            # run the App DEV scheme
```

Setup, the prod build, and how the scripts fit together are in [`docs/ios.md`](docs/ios.md).

## Testing and Quality

```bash
npm run lint              # ESLint (repo-wide)
npm run typecheck:server  # tsc for server/
npm run test              # Vitest with coverage: app (jsdom) + server (node) projects
npm run test:server       # server project only
npm run build             # production web build into www/
npm run test:scripts      # Node script tests (scripts/*.test.mjs)
npm run format:check      # Prettier
```

Commits are checked by husky: `lint-staged` (Prettier and `eslint --fix` on staged files) runs on pre-commit, and `commitlint` (Conventional Commits) runs on commit-msg.

## CI/CD

| Workflow                                    | Trigger                            | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CI PR Checks` (`ci-pr.yml`)                | PRs to `main`                      | **Quality Checks**: format, lint, server type-check, unit tests with coverage (uploaded to Codecov), script tests, production build. **iOS prod build validation**: the `ios-prod` Angular build ([`docs/ios.md`](docs/ios.md)). **Docker Build Validation**: builds both images for amd64 without pushing                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `Release & Publish` (`release-publish.yml`) | push to `main`, manual (main only) | Releases the latest `main`: bumps the version from Conventional Commits (`devx release version`: `feat` → minor, `fix`/others → patch, `!`/`BREAKING CHANGE` → major), updates `CHANGELOG.md`, and pushes the release commit and `vX.Y.Z` tag atomically. Then rebuilds only the images whose inputs changed (`scripts/image-should-publish.mjs`; a version-only bump of `package.json` doesn't count) and re-tags the unchanged one, so every version tag exists for both images. A run that loses a race with a newer merge is superseded by the next run. Manual runs can force-publish both When the release changes only web code, edge also gets a signed iOS OTA bundle ([`docs/ios.md`](docs/ios.md) → OTA updates) |
| `Secret Scan` (`secret-scan.yml`)           | PRs, push to `main`                | gitleaks (`.gitleaks.toml`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `CodeQL` (`codeql.yml`)                     | PRs, push to `main`, weekly        | Static analysis of TypeScript and workflows (`.github/codeql/codeql-config.yml`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `iOS TestFlight` (`ios-testflight.yml`)     | after `Release & Publish`, manual  | Builds App PROD with Fastlane and uploads it to TestFlight when the release changed native code (`scripts/ios-release-gate.mjs`; web-only releases ship as OTA bundles in the edge image instead), then records the build for OTA updates. Secrets and one-time setup: [`docs/ios.md`](docs/ios.md) → TestFlight, OTA updates                                                                                                                                                                                                                                                                                                                                                                                               |
| `Claude Code Review` / `Claude Code`        | PRs / `@claude` mentions           | AI review and assistant (keep these files byte-identical to `main`; see `.prettierignore`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Releases skip themselves: the release commit is `chore(release): vX.Y.Z [skip ci]`.

**One-time repository setup** (Settings → Secrets and variables → Actions):

- `AUTOCOMMIT_CLIENT_ID` (variable) and `AUTOCOMMIT_APP_PRIVATE_KEY` (secret): the release GitHub App (the same one go-gather uses). Install the app on this repository and add it as a bypass actor on the `main` ruleset so the release commit can be pushed.
- `CODECOV_TOKEN` (secret): coverage uploads. Until it's set, uploads are best-effort and don't fail PRs.
- iOS TestFlight: App Store Connect API key, match password and access, and `IOS_BACKEND_ORIGIN_PROD`, in the `production` environment. See [`docs/ios.md`](docs/ios.md) → TestFlight.
- iOS OTA updates: `IOS_LIVE_UPDATE_PRIVATE_KEY` (secret, `production` environment). The release GitHub App also needs **Variables: write**, so the workflows can record `IOS_OTA_NATIVE_BUILD` and `IOS_OTA_BUNDLE_SHA`.
- `CLAUDE_CODE_OAUTH_TOKEN` (secret): already configured.

## Deployment

Two Docker images, `server` (`server/Dockerfile`) and `edge` (`edge/Dockerfile`), run as a Portainer stack on the Synology NAS from `docker-compose.yml`. Public traffic goes Cloudflare → cloudflared tunnel → Nginx Proxy Manager → `edge` → `server`; only `edge` is published on the host. The full walkthrough (directories and permissions, Portainer variables, NPM and Cloudflare settings, verification, first sign-in, backups, updates) is in [`docs/nas-deployment.md`](docs/nas-deployment.md). When Nginx Proxy Manager runs in Docker on the same host, add `docker-compose.npm.yml` so edge joins its network and only NPM is trusted to set the client IP.

To try the production stack locally (builds both images, runs in development mode with Docker volumes, so nothing needs creating or `chown`-ing):

```bash
PUBLIC_ORIGIN=http://localhost:8080 docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

Open http://localhost:8080 and set up with `local-setup-token-0123456789` (override with `SETUP_TOKEN`). `docker compose … down -v` resets the data.
