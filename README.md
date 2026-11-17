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
- `server/`: Fastify API with SQLite storage: sync and health today; auth, card catalog, and image cache _(planned)_ (npm workspace)
- `edge/`: Caddy container serving the web app and proxying `/api` to `server` _(planned)_
- `ios/`: Capacitor iOS project with App DEV / App PROD targets _(planned)_
- `docs/`: sync rules ([`docs/sync.md`](docs/sync.md)); deployment, auth, and iOS docs _(planned)_
- `.github/`: PR/issue templates, Dependabot, and (planned) CI, release, TestFlight, and security workflows

## Prerequisites

- Node.js `24.22.2` (see `.nvmrc`)
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

3. Run the API server (separate terminal):

```bash
npm run start:server
```

The app opens at `http://localhost:4200`. `ng serve` proxies `/api` and `/images` to `http://127.0.0.1:3000` (`proxy.conf.json`), so the app and API share one origin in dev, matching production behind `edge`. Without the server running, Settings shows "Sync failed: will retry" and everything else still works from local storage.

> Port 3000 is a common default. If another local project already listens on `127.0.0.1:3000`, the PokePaper server can still bind `0.0.0.0:3000` while the proxy reaches the other project. Free the port, or run the server with `PORT=3001 npm run start:server` and point `proxy.conf.json` at it.

## Server

Fastify 5 + better-sqlite3, run with `tsx` (no build step). It stores data in `server/data/pokepaper.db` (WAL mode) and applies the checksummed migrations in `server/src/migrations/` on startup.

| Route                 | Purpose                                                       |
| --------------------- | ------------------------------------------------------------- |
| `GET /api/health`     | 200 `{ status: 'ok' }` when the database answers, else 503    |
| `POST /api/sync/push` | Apply queued client operations (idempotent, last-writer-wins) |
| `POST /api/sync/pull` | Page through the compacted change log from a cursor           |

Configuration (environment variables, all optional):

| Variable                | Default            | Purpose                                                           |
| ----------------------- | ------------------ | ----------------------------------------------------------------- |
| `HOST` / `PORT`         | `0.0.0.0` / `3000` | Listen address                                                    |
| `DATA_DIR`              | `server/data`      | SQLite database directory                                         |
| `BACKUP_DIR`            | `server/backups`   | `VACUUM INTO` snapshots                                           |
| `BACKUP_KEEP`           | `14`               | Snapshots retained                                                |
| `BACKUP_INTERVAL_HOURS` | `24`               | Backup schedule (one also runs at startup; `0` = startup only)    |
| `TRUST_PROXY`           | `false`            | Trust `X-Forwarded-*` (on behind edge in production)              |
| `RATE_LIMIT_PER_MINUTE` | `600`              | Requests per client IP per minute, across all routes (429 beyond) |
| `LOG_LEVEL`             | `info`             | pino log level                                                    |

Invalid values fail startup with a clear error.

## App Architecture

- **Local-first storage.** All structured data goes through the `StorageEngine` interface (`src/app/core/data/`): Dexie/IndexedDB on the web, `@capacitor-community/sqlite` on iOS. Both engines run the same contract test suite.
- **Sync.** Writes update local storage and queue an outbox entry in one transaction. `SyncService` pushes the outbox to `POST /api/sync/push` and pulls the server change log from `POST /api/sync/pull` on startup, every 30 seconds, when the browser comes back online, and after each local write. A 401 pauses sync (outbox kept) until the user signs in again. Conflict rules and the server contract are in [`docs/sync.md`](docs/sync.md).
- **Offline web shell.** Production web builds register an Angular service worker (`ngsw-config.json`) so the app opens with no signal. iOS builds don't need it: the bundle ships inside the app.

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

## Deployment _(planned)_

Two Docker images, `server` and `edge`, are published to GHCR and deployed on a Synology NAS via Portainer. Public traffic goes Cloudflare → cloudflared tunnel → Nginx Proxy Manager → `edge`. See `docs/nas-deployment.md` once it lands.
