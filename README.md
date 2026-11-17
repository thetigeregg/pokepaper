# PokePaper

PokePaper is a one-user Ionic + Angular app for the Pokémon Trading Card Game:

- Browse every card from every series and set
- Track which cards you own
- Build decks
- Read cards in other languages

It runs as a web app and as a native iOS app (Capacitor). It works offline: data lives on the device and syncs when online. It's served on the public internet behind passkey-only authentication.

> **Status:** early scaffolding. This repo is being built in phases: tooling → app shell → server → passkey auth → Docker/deploy → CI/CD → iOS. Sections marked _(planned)_ describe pieces that haven't landed yet.

## Repository Structure

- `scripts/`: Node tooling (devx worktree adapter; iOS build/version/environment scripts _(planned)_), each with `*.test.mjs` tests
- `src/`: frontend app (Ionic/Angular, web + Capacitor iOS) _(planned)_
- `server/`: Fastify API with SQLite storage (catalog, sync, auth, image cache) _(planned)_
- `shared/`: domain and API types shared by the frontend and server (npm workspace) _(planned)_
- `edge/`: Caddy container serving the web app and proxying `/api` to `server` _(planned)_
- `ios/`: Capacitor iOS project with App DEV / App PROD targets _(planned)_
- `docs/`: deployment, auth, and iOS docs _(planned)_
- `.github/`: PR/issue templates, Dependabot, and (planned) CI, release, TestFlight, and security workflows

## Prerequisites

- Node.js `24.22.2` (see `.nvmrc`)
- npm

## Local Development

```bash
npm ci
```

## Testing and Quality

```bash
npm run format:check  # Prettier
npm run test:scripts  # Node script tests (scripts/*.test.mjs)
```

Commits are checked by husky: `lint-staged` runs on pre-commit, and `commitlint` (Conventional Commits) runs on commit-msg.

## Deployment _(planned)_

Two Docker images, `server` and `edge`, are published to GHCR and deployed on a Synology NAS via Portainer. Public traffic goes Cloudflare → cloudflared tunnel → Nginx Proxy Manager → `edge`. See `docs/nas-deployment.md` once it lands.
