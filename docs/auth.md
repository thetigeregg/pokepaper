# Authentication

PokePaper is a one-user app on the public internet, protected by **passkeys only**: no usernames or passwords. Passkeys are WebAuthn credentials unlocked with Face ID, Touch ID, or a device PIN, and synced across your devices by your platform (e.g. iCloud Keychain).

Server: `server/src/auth/`. Client: `src/app/core/auth/`, `src/app/login/`, `src/app/features/account/`. Wire types: `shared/src/auth.ts`.

## How it works

### Passkeys

- **Library:** [SimpleWebAuthn](https://simplewebauthn.dev/) on both sides (`@simplewebauthn/server`, `@simplewebauthn/browser`).
- **Relying party:** the RP ID is the app's hostname (`RP_ID`, default: `PUBLIC_ORIGIN`'s hostname). Passkeys are bound to it, so **changing the domain invalidates every passkey**. The expected origin is `PUBLIC_ORIGIN`.
- **Requirements:** passkeys must be discoverable (resident) and user-verified, so sign-in needs no username and always involves biometrics or a PIN. Attestation is not requested.
- **Challenges:** stored server-side (`auth_challenges`), bound to their purpose (register or login), valid for 5 minutes, and deleted when used, so they can't be replayed.
- **Account:** a single account whose WebAuthn user handle is generated once (`server_meta.webauthn_user_id`).

### First passkey: the setup token

Before any passkey exists, registering one requires a **setup token**: a secret only the server operator knows.

- In production: a file at `SETUP_TOKEN_FILE` (Docker: `nas-secrets/setup_token`, mounted at `/run/secrets/setup_token`). The file is re-read on every attempt, so **delete it after setting up** to close setup without a restart.
- In local dev: `SETUP_TOKEN=…` (convenience).
- Tokens shorter than 16 characters are ignored. Comparison is constant-time.

Once a passkey exists, setup is closed even with the token. Further passkeys can only be added from a signed-in session (Settings → Passkeys → Add). The "no passkey yet" check and the insert share one transaction, so two simultaneous setups can't both succeed.

### Sessions

- Created on setup and on every passkey sign-in: 32 random bytes, stored only as a SHA-256 hash. The `sessions.id` shown in device lists is a separate random identifier.
- **Sliding expiry:** `SESSION_TTL_DAYS` (default 90), extended at most hourly while in use. A device you use at least every 90 days stays signed in.
- **Web:** an `__Host-pokepaper_session` cookie, `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`. JavaScript can't read it, and the `__Host-` prefix stops any other host from setting it.
- **iOS:** the server supports `client: 'ios'`, which returns the token in the response body instead of setting a cookie. The app sends it as `Authorization: Bearer …` and keeps it in the Keychain. _(Server side done; the native client side lands with the iOS shell.)_
- Removing a passkey signs out every session created with it.

### What requires a session

Every route requires a session **except** `GET /api/health`, `GET /api/auth/status`, and the passkey ceremony routes under `/api/auth/register/*` and `/api/auth/login/*`. Registration does its own check: a signed-in session, or the setup token before any passkey exists. Routes opt out with `config: { auth: 'public' }`; anything else, including unknown routes, gets `401 { error: 'Sign in required' }`.

### Hardening

- **Rate limits** per client IP: 600 requests/minute overall, and 20/minute (`AUTH_RATE_LIMIT_PER_MINUTE`) on the unauthenticated auth routes. The client IP comes from `CLIENT_IP_HEADER` (`cf-connecting-ip` behind Cloudflare, which overwrites it so clients can't spoof it). Rate limiting runs before the session check, and the session check runs before the request body is read (`preParsing`), so floods of bad tokens are throttled before they cost a lookup and unauthenticated bodies are never parsed.
- **CSRF:** `SameSite=Strict` cookies, plus a 403 for any state-changing cookie request whose `Origin` isn't `PUBLIC_ORIGIN`, including the passkey registration routes. Bearer tokens are never sent implicitly, so they skip that check.
- **No CORS:** browsers only talk to the app's own origin through `edge`, and the iOS app uses native HTTP (`CapacitorHttp`), which isn't subject to CORS.
- Client errors keep their status (malformed JSON 400, body too large 413, unsupported media type 415, rate limited 429). Only unexpected errors become a generic `500`, without details.
- Registering a passkey that already exists returns `409`.

### Offline behavior (client)

Sign-in state on the device is a local marker (`pokepaper.auth.signedIn` in Preferences), not a server call:

- Once signed in, the app opens straight to the tabs **with or without a connection**. All data is local.
- When the server rejects the session (sync gets a 401), sync pauses, the marker is cleared, and the app shows the sign-in screen. **Queued offline changes are kept** and sync after signing back in.
- **Sync runs only while signed in.** Signing out pauses it immediately, and a sync cycle already in flight stops before its next request.
- **Signing out works offline.** The local sign-out applies immediately. A sign-out that couldn't reach the server is remembered (`pokepaper.auth.pendingSignOut`) and completed before the sign-in screen next checks the session, so the still-valid cookie can't silently sign you back in.
- Any signed-in account call that gets a `401` (session expired, revoked from another device, or its passkey removed) signs out locally and shows the sign-in screen.
- First-time sign-in needs a connection. The sign-in screen says so when the server is unreachable.

## Routes

| Route                                          | Auth                   | Purpose                                                         |
| ---------------------------------------------- | ---------------------- | --------------------------------------------------------------- |
| `GET /api/auth/status`                         | public                 | `{ registered, authenticated, setupAvailable }`                 |
| `POST /api/auth/register/options` / `…/verify` | setup token or session | Register a passkey (setup also signs in)                        |
| `POST /api/auth/login/options` / `…/verify`    | public                 | Sign in with a passkey                                          |
| `POST /api/auth/logout`                        | session                | End this session                                                |
| `GET /api/auth/credentials`, `DELETE …/:id`    | session                | List and remove passkeys (the last one can't be removed)        |
| `GET /api/auth/sessions`, `DELETE …/:id`       | session                | List and revoke signed-in devices (revoking your own signs out) |

## Configuration

| Variable                     | Default                 | Purpose                                                                        |
| ---------------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| `PUBLIC_ORIGIN`              | `http://localhost:4200` | Origin the app is served from. **Required** (https) when `NODE_ENV=production` |
| `RP_ID`                      | `PUBLIC_ORIGIN` host    | WebAuthn relying-party ID                                                      |
| `RP_NAME`                    | `PokePaper`             | Name shown in passkey prompts                                                  |
| `SESSION_TTL_DAYS`           | `90`                    | Sliding session lifetime                                                       |
| `SETUP_TOKEN_FILE`           | _(unset)_               | File with the first-passkey setup token (production)                           |
| `SETUP_TOKEN`                | _(unset)_               | Literal setup token (local dev); the file wins if both are set                 |
| `AUTH_RATE_LIMIT_PER_MINUTE` | `20`                    | Per-IP limit on unauthenticated auth routes                                    |
| `AUTH_DEV_BYPASS`            | `false`                 | Treat every request as signed in. Refused when `NODE_ENV=production`           |

`PUBLIC_ORIGIN` must be `https` unless it's localhost, and must be an origin only (no path).

## Local development

Browsers allow WebAuthn on `http://localhost`, so passkeys work in dev:

```bash
SETUP_TOKEN=dev-setup-token-0123456789 npm run start:server
npm start   # http://localhost:4200
```

Open the app, enter the setup token, and create a passkey. Chrome's DevTools → **WebAuthn** panel can emulate an authenticator if your machine has none. The session cookie is `Secure`, which Chrome accepts on `http://localhost`.

An iOS build pointed at a LAN IP can't use passkeys: they need the real HTTPS domain. For that case only, run the server with `AUTH_DEV_BYPASS=true`. It logs a warning at startup and is refused in production.

## Recovering access

- **Lost a device:** sign in on another device (synced passkeys are usually available everywhere), then remove the lost device's session and/or passkey in Settings.
- **Lost every passkey:** on the server, delete the credentials and sessions, then create a new setup token:

  ```bash
  sqlite3 /path/to/pokepaper.db 'DELETE FROM webauthn_credentials; DELETE FROM sessions;'
  openssl rand -base64 32 > /path/to/nas-secrets/setup_token
  ```

  Open the app, set up a new passkey, then delete the token file again.

## Deployment checklist

1. `PUBLIC_ORIGIN=https://pokepaper.<your-domain>` and `NODE_ENV=production`.
2. `TRUST_PROXY_HOPS` and `CLIENT_IP_HEADER=cf-connecting-ip` (see `README.md` → Server).
3. `openssl rand -base64 32 > nas-secrets/setup_token` and `SETUP_TOKEN_FILE=/run/secrets/setup_token`.
4. Register your first passkey, then delete `nas-secrets/setup_token`.
