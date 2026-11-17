# NAS Deployment (Synology + Docker + Cloudflare Tunnel)

PokePaper runs as two containers on the NAS, deployed as a Portainer stack from `docker-compose.yml`:

- `server`: the Fastify API with SQLite. Internal only, never published on the host.
- `edge`: Caddy serving the built web app, proxying `/api` and `/images` to `server`, serving `/.well-known/apple-app-site-association`, and adding security headers.

Unlike go-gather and game-shelf (tailnet-only), PokePaper is **public**. Traffic flows:

```
browser / iOS app ─HTTPS→ Cloudflare ─tunnel→ cloudflared ─→ Nginx Proxy Manager ─→ edge :8080 ─→ server :3000
```

TLS terminates at Cloudflare. Everything is protected by passkeys (`docs/auth.md`), and only `edge` is published on the NAS.

## 1. Directories, permissions, and the setup token

The server container runs unprivileged as **PUID:PGID** (default `1000:1000`, the image's `node` user). Its data folders and the setup token must be accessible to that uid.

**On a Synology shared folder, use your own DSM user.** Shared folders carry ACLs that override `chown`/`chmod`: a uid the ACL doesn't list (like 1000) is denied even when it owns the folder. Run the container as a DSM user the share already allows instead:

```bash
id <dsm-user>                         # prints uid=<puid>(<dsm-user>) gid=<pgid>(…)
ROOT=/volumeN/<shared-folder>/pokepaper   # anywhere inside a shared folder you can write
mkdir -p "$ROOT/server-data" "$ROOT/server-backups" "$ROOT/secrets"

# One-time token for registering the first passkey (only your user can read it)
openssl rand -base64 32 > "$ROOT/secrets/setup_token" && chmod 400 "$ROOT/secrets/setup_token"
```

Then set `PUID` / `PGID` to those IDs in the stack variables (section 3).

**Elsewhere (plain Linux permissions, no ACLs):** keep the default 1000:1000 and give the folders to that uid:

```bash
sudo mkdir -p "$ROOT/server-data" "$ROOT/server-backups" "$ROOT/secrets"
sudo chown -R 1000:1000 "$ROOT/server-data" "$ROOT/server-backups"
openssl rand -base64 32 | sudo tee "$ROOT/secrets/setup_token" > /dev/null
sudo chown 1000:1000 "$ROOT/secrets/setup_token" && sudo chmod 400 "$ROOT/secrets/setup_token"
```

**Check access before deploying.** Run the real image as the configured user with the real mounts. Set `PUID` / `PGID` to the values you'll use for the stack. Expect three `OK` lines:

```bash
PUID=<puid> PGID=<pgid>
sudo docker run --rm --entrypoint sh --user "$PUID:$PGID" \
  -v "$ROOT/server-data:/app/server/data" \
  -v "$ROOT/server-backups:/app/server/backups" \
  -v "$ROOT/secrets:/run/secrets:ro" \
  ghcr.io/thetigeregg/pokepaper-server:main -c '
    touch /app/server/data/.t && rm /app/server/data/.t && echo "server-data: OK"
    touch /app/server/backups/.t && rm /app/server/backups/.t && echo "server-backups: OK"
    cat /run/secrets/setup_token > /dev/null && echo "setup_token: OK"'
```

The folders hold:

- `server-data`: the SQLite database (`pokepaper.db`, `-wal`, `-shm`).
- `server-backups`: database snapshots (see section 8).
- `secrets`: one file per secret, mounted read-only at `/run/secrets`.

If the server logs `EACCES` or `SQLITE_CANTOPEN`, the data folders aren't writable by PUID:PGID. If the sign-in screen says "Setup isn't enabled", the setup token is missing or not readable by PUID:PGID.

## 2. Images

The release workflow publishes `ghcr.io/thetigeregg/pokepaper-server` and `ghcr.io/thetigeregg/pokepaper-edge` (`:main`) on merges to `main` that change them. Both are **amd64**, matching the DS920+ (x86_64). These are the compose file's default images.

Every release is also tagged by version (`v0.3.1`, `0.3.1`, `0.3`, `0`) and commit (`sha-…`), so you can pin `SERVER_IMAGE`/`EDGE_IMAGE` to a version instead of `:main`.

> **Pull access:** GHCR packages start out private. Either make both packages public (GitHub → your profile → Packages → `pokepaper-server` / `pokepaper-edge` → Package settings → Change visibility), or log the NAS in once with a personal access token that has `read:packages`: `docker login ghcr.io -u <github-user>`.

Check the published images are reachable:

```bash
docker manifest inspect ghcr.io/thetigeregg/pokepaper-server:main
docker manifest inspect ghcr.io/thetigeregg/pokepaper-edge:main
```

To build them yourself, from a repo checkout on an amd64 machine (or with `docker buildx build --platform linux/amd64`):

```bash
docker build -f server/Dockerfile -t pokepaper-server:local .
docker build -f edge/Dockerfile -t pokepaper-edge:local .
```

## 3. Deploy the stack (Portainer)

Create a stack from `docker-compose.yml` (upload it or point Portainer at the repo) with these environment variables:

| Variable           | Example                             | Notes                                                                     |
| ------------------ | ----------------------------------- | ------------------------------------------------------------------------- |
| `PUBLIC_ORIGIN`    | `https://pokepaper.example.com`     | **Required.** The public HTTPS origin. Passkeys are bound to its hostname |
| `NAS_DATA_ROOT`    | `/volume1/docker/pokepaper`         | Parent of `server-data` and `server-backups`                              |
| `SECRETS_HOST_DIR` | `/volume1/docker/pokepaper/secrets` | Holds `setup_token`                                                       |
| `EDGE_PORT`        | `8080`                              | Host port Nginx Proxy Manager forwards to. Pick a free one                |
| `PUID` / `PGID`    | `<puid>` / `<pgid>`                 | User the server runs as (default `1000`/`1000`); see section 1            |
| `TRUSTED_PROXIES`  | _(default `private_ranges`)_        | Proxies allowed to set `CF-Connecting-IP`; see section 4                  |
| `TZ`               | `Europe/Zurich`                     |                                                                           |
| `SERVER_IMAGE`     | _(default `…-server:main`)_         | Override to pin a version                                                 |
| `EDGE_IMAGE`       | _(default `…-edge:main`)_           | Override to pin a version                                                 |

The compose file already sets `NODE_ENV=production`, `SETUP_TOKEN_FILE`, `CLIENT_IP_HEADER=cf-connecting-ip`, and `TRUST_PROXY_HOPS=1`. Optional server settings (session lifetime, backups, rate limits) are listed, commented, in `docker-compose.yml`. All server settings are in `README.md` → Server and `docs/auth.md` → Configuration.

`edge` waits for `server` to report healthy. Both have healthchecks, so `docker compose ps` / Portainer shows `healthy` once they're up.

## 4. Nginx Proxy Manager

Add a **Proxy Host**:

- **Domain:** `pokepaper.<your-domain>`
- **Scheme / Forward host / port:** `http` / the NAS's LAN IP (or the Docker host gateway) / `EDGE_PORT`
- **Cache Assets:** **off**. Edge already sends the right caching headers (immutable hashed assets, revalidated `index.html` and service worker files). NPM's asset cache would override them and can serve stale app versions.
- **Block Common Exploits:** optional.
- **Websockets Support:** not needed.
- **SSL:** follow your existing tunnel pattern for other services (cloudflared → NPM). TLS to the browser is Cloudflare's.

NPM passes request headers through unchanged, including Cloudflare's `CF-Connecting-IP`, which the server uses for rate limiting.

**Narrowing `TRUSTED_PROXIES` (recommended).** Edge only accepts `CF-Connecting-IP` from trusted proxies. From anything else, it overwrites the header with the connection's own address, so a spoofed header can't dodge the rate limits. The default trusts every private address, which includes other devices on your LAN that can reach `EDGE_PORT` directly. To trust only NPM:

1. Find the address NPM's requests arrive from. If NPM runs in Docker on the NAS and forwards to `<nas-ip>:EDGE_PORT`, that's usually the Docker bridge gateway (e.g. `172.17.0.1`) or NPM's container IP:

   ```bash
   docker inspect <npm-container> --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{.Gateway}} {{end}}'
   ```

2. Set `TRUSTED_PROXIES` to that address or a small CIDR (space-separated for several), e.g. `172.17.0.1/32`, and redeploy.
3. Confirm sign-in still works through the public URL. If the address is wrong, nothing breaks, but every visitor shares one rate-limit bucket (NPM's address) instead of being counted separately.

## 5. Cloudflare

1. **Tunnel:** in Zero Trust → Networks → Tunnels → your tunnel → **Public Hostname**, add `pokepaper.<your-domain>` → your NPM service (the same way as your other services).
2. **SSL/TLS:** "Always Use HTTPS" on. Edge sends `Strict-Transport-Security`.
3. **Rocket Loader: off** (Speed → Optimization). It rewrites `<script>` tags, which the app's Content-Security-Policy blocks.
4. **Caching:** the defaults are fine (Cloudflare doesn't cache API JSON). If you use a "Cache Everything" rule anywhere on the zone, exclude `pokepaper.<your-domain>/api/*`.
5. **Bots and Apple's passkey check:** Apple fetches `/.well-known/apple-app-site-association` through its own CDN to allow passkeys in the iOS app. Bot Fight Mode can challenge that fetcher, and on the Free plan it can't be skipped per path. After deploying, check (section 6). If the check fails while Bot Fight Mode is on, turn it off for the zone, or (on paid plans) add a WAF skip rule for that path.
6. **Optional:** a WAF rate-limiting rule on `/api/auth/*` adds a limit in front of the server's own.

## 6. Verify

```bash
# On the NAS
docker compose ps                                  # both healthy
docker compose logs -f server                      # "Server listening", "backup.written"
curl -s http://127.0.0.1:${EDGE_PORT:-8080}/api/health   # {"status":"ok"}

# From anywhere
curl -s https://pokepaper.<your-domain>/api/health                               # {"status":"ok"}
curl -sI https://pokepaper.<your-domain>/ | grep -i content-security-policy      # edge headers present
curl -s https://pokepaper.<your-domain>/api/auth/status                          # {"registered":false,…,"setupAvailable":true}
curl -s https://pokepaper.<your-domain>/.well-known/apple-app-site-association   # JSON with the app IDs
curl -s https://app-site-association.cdn-apple.com/a/v1/pokepaper.<your-domain>  # same JSON via Apple's CDN (may take a while to appear)
```

## 7. First sign-in

1. Open `https://pokepaper.<your-domain>`. The sign-in screen shows **Set up PokePaper**.
2. Paste the setup token, name the passkey, and confirm with Face ID / Touch ID / your PIN.
3. **Delete the setup token** to close setup (it's re-read on each attempt, so no restart is needed):

   ```bash
   sudo rm /volume1/docker/pokepaper/secrets/setup_token
   ```

4. Add passkeys for your other devices from Settings → Passkeys (synced passkeys, e.g. iCloud Keychain, usually appear on your other devices automatically).

Lost every passkey? See `docs/auth.md` → Recovering access.

## 8. Backups and restore

The server writes a consistent snapshot to `server-backups/` at startup (unless one is less than `BACKUP_INTERVAL_HOURS` old) and every `BACKUP_INTERVAL_HOURS` (default 24), keeping the newest `BACKUP_KEEP` (default 14). Include `server-backups` (or `server-data`) in your regular NAS backups (Hyper Backup, snapshots, …).

To restore:

```bash
docker compose stop server
cp server-backups/pokepaper-<timestamp>.db server-data/pokepaper.db
rm -f server-data/pokepaper.db-wal server-data/pokepaper.db-shm
sudo chown "$PUID:$PGID" server-data/pokepaper.db   # only needed if you copied as another user
docker compose start server
```

Each snapshot carries its own sync epoch, so after a restore every device automatically re-syncs from scratch. Changes devices made after the snapshot was taken and haven't pushed yet are kept on the devices and pushed again (`docs/sync.md`).

## 9. Updating

CI publishes new images on merges to `main`. In Portainer, **Pull and redeploy** the stack (or `docker compose pull && docker compose up -d`). Database migrations run automatically at server start. A migration that was edited after being applied stops the server with a clear error rather than corrupting data.

Changing `PUBLIC_ORIGIN` (the domain) invalidates every passkey, because they're bound to the hostname. Plan that like a fresh setup.
