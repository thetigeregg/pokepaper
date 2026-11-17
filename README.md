# PokePaper

PokePaper is a one-user Ionic + Angular app for the Pokémon Trading Card Game:

- Browse every card from every series and set
- Track which cards you own
- Build decks
- Read cards in other languages

It runs as a web app and as a native iOS app (Capacitor). It works offline: data lives on the device and syncs when online. It's served on the public internet behind passkey-only authentication.

> **Status:** early scaffolding. This repo is being built in phases: tooling → app shell → server → passkey auth → Docker/deploy → CI/CD → iOS. Sections marked _(planned)_ describe pieces that haven't landed yet.

## Repository Structure

- `src/`: frontend app (Ionic/Angular, web + Capacitor iOS)
- `shared/`: domain and sync wire types shared by the frontend and server (`@pokepaper/shared`, npm workspace)
- `scripts/`: Node tooling (devx worktree adapter; iOS build/version/environment scripts _(planned)_), each with `*.test.mjs` tests
- `public/`: static web assets (favicon, web app manifest)
- `server/`: Fastify API with SQLite storage (sync, auth, catalog, image cache) _(planned)_
- `edge/`: Caddy container serving the web app and proxying `/api` to `server` _(planned)_
- `ios/`: Capacitor iOS project with App DEV / App PROD targets _(planned)_
- `docs/`: deployment, auth, and iOS docs _(planned)_
- `.github/`: PR/issue templates, Dependabot, and (planned) CI, release, TestFlight, and security workflows

## Prerequisites

- Node.js `24.22.2` (see `.nvmrc`)
- npm

## Local Development

1. Install dependencies (npm workspaces: installs the root app and `shared/` together):

```bash
npm ci
```

2. Run the frontend dev server:

```bash
npm start
```

The app opens at `http://localhost:4200`. `ng serve` proxies `/api` and `/images` to `http://127.0.0.1:3000` (`proxy.conf.json`), so the app and API share one origin in dev, matching production behind `edge`. Until the server lands, Settings shows "Sync failed: will retry"; everything else works from local storage.

## App Architecture

- **Local-first storage.** All structured data goes through the `StorageEngine` interface (`src/app/core/data/`): Dexie/IndexedDB on the web, `@capacitor-community/sqlite` on iOS. Both engines run the same contract test suite.
- **Sync.** Writes update local storage and queue an outbox entry in one transaction. `SyncService` pushes the outbox to `POST /api/sync/push` and pulls the server change log from `POST /api/sync/pull` on startup, every 30 seconds, when the browser comes back online, and after each local write. A 401 pauses sync (outbox kept) until the user signs in again.
- **Offline web shell.** Production web builds register an Angular service worker (`ngsw-config.json`) so the app opens with no signal. iOS builds don't need it: the bundle ships inside the app.

## Testing and Quality

```bash
npm run lint          # ESLint (repo-wide)
npm run test          # Vitest with coverage (app + shared)
npm run build         # production web build into www/
npm run test:scripts  # Node script tests (scripts/*.test.mjs)
npm run format:check  # Prettier
```

Commits are checked by husky: `lint-staged` (Prettier and `eslint --fix` on staged files) runs on pre-commit, and `commitlint` (Conventional Commits) runs on commit-msg.

## Deployment _(planned)_

Two Docker images, `server` and `edge`, are published to GHCR and deployed on a Synology NAS via Portainer. Public traffic goes Cloudflare → cloudflared tunnel → Nginx Proxy Manager → `edge`. See `docs/nas-deployment.md` once it lands.
