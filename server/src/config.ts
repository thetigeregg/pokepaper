import { resolve } from 'node:path';
import { CATALOG_LANGUAGES, isCatalogLanguage, type CatalogLanguage } from '@pokepaper/shared';

export interface AuthConfig {
  /** Origin the app is served from (e.g. https://pokepaper.example.com); WebAuthn's expected origin. */
  publicOrigin: string;
  /** WebAuthn relying-party ID; defaults to the publicOrigin hostname. Passkeys are bound to it. */
  rpId: string;
  rpName: string;
  /** Sliding session lifetime. */
  sessionTtlDays: number;
  /** Literal setup token (dev convenience). Prefer setupTokenFile in production. */
  setupToken: string | null;
  /**
   * File holding the one-time setup token for the first passkey. Re-read on
   * each use, so deleting the file disables setup without a restart.
   */
  setupTokenFile: string | null;
  /** Requests per client IP per minute on the unauthenticated auth routes. */
  rateLimitPerMinute: number;
  /**
   * Treat every request as signed in. Local development only (an iOS build
   * pointed at a LAN IP can't use passkeys); refused when NODE_ENV=production.
   */
  devBypass: boolean;
}

export interface CatalogConfig {
  /** Run the scheduled TCGdex import (docs/catalog.md). */
  syncEnabled: boolean;
  /** Languages to import, in display order. */
  languages: CatalogLanguage[];
  /** Hours between imports. */
  refreshHours: number;
  /** Days between full refreshes (which refetch every card). */
  fullRefreshDays: number;
  /**
   * Hours between price passes (which fetch every card once). A pass runs
   * after a scheduled import, so effectively at least `refreshHours`.
   */
  pricesRefreshHours: number;
}

export interface ServerConfig {
  host: string;
  port: number;
  /** Directory holding the SQLite database (`pokepaper.db`). */
  dataDir: string;
  /** Directory for database snapshots. */
  backupDir: string;
  /** Snapshots kept; older ones are deleted after each backup. */
  backupKeep: number;
  /** Hours between scheduled backups (plus one at startup unless a recent snapshot exists). 0 = startup only. */
  backupIntervalHours: number;
  /**
   * Number of reverse proxies in front of the server whose X-Forwarded-*
   * headers to trust (0 = none). A hop count, never "trust all": with
   * blanket trust, request.ip becomes the left-most X-Forwarded-For entry,
   * which any client can set.
   */
  trustProxyHops: number;
  /**
   * Header carrying the real client IP, set by the outermost proxy (in
   * production Cloudflare's `cf-connecting-ip`, which Cloudflare always
   * overwrites, so clients can't spoof it). Used to key rate limits; falls
   * back to request.ip when unset or absent. Lowercase.
   */
  clientIpHeader: string | null;
  /** Requests per client IP per minute, across all routes. */
  rateLimitPerMinute: number;
  logLevel: string;
  production: boolean;
  auth: AuthConfig;
  catalog: CatalogConfig;
}

type Env = Record<string, string | undefined>;

const SERVER_ROOT = resolve(import.meta.dirname, '..');

function readInt(env: Env, key: string, fallback: number, min: number, max?: number): number {
  const raw = env[key]?.trim();
  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || (max !== undefined && value > max)) {
    const range = max === undefined ? `>= ${String(min)}` : `from ${String(min)} to ${String(max)}`;
    throw new Error(`${key} must be an integer ${range} (got "${raw}")`);
  }

  return value;
}

function readBool(env: Env, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (raw === 'true' || raw === '1') {
    return true;
  }
  if (raw === 'false' || raw === '0') {
    return false;
  }

  throw new Error(`${key} must be true/false (got "${raw}")`);
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function loadAuthConfig(env: Env, production: boolean): AuthConfig {
  const rawOrigin = env['PUBLIC_ORIGIN']?.trim() || 'http://localhost:4200';
  let url: URL;
  try {
    url = new URL(rawOrigin);
  } catch {
    throw new Error(
      `PUBLIC_ORIGIN must be a URL like https://pokepaper.example.com (got "${rawOrigin}")`
    );
  }
  if (url.origin !== rawOrigin.replace(/\/$/, '')) {
    throw new Error(`PUBLIC_ORIGIN must be an origin only, without a path (got "${rawOrigin}")`);
  }

  const isLocal = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !isLocal) {
    throw new Error(`PUBLIC_ORIGIN must use https unless it is localhost (got "${url.origin}")`);
  }
  if (production && isLocal) {
    throw new Error(
      'PUBLIC_ORIGIN must be set to the public https origin when NODE_ENV=production'
    );
  }

  const devBypass = readBool(env, 'AUTH_DEV_BYPASS', false);
  if (devBypass && production) {
    throw new Error('AUTH_DEV_BYPASS cannot be enabled when NODE_ENV=production');
  }

  return {
    publicOrigin: url.origin,
    rpId: env['RP_ID']?.trim() || url.hostname,
    rpName: env['RP_NAME']?.trim() || 'PokePaper',
    sessionTtlDays: readInt(env, 'SESSION_TTL_DAYS', 90, 1),
    setupToken: env['SETUP_TOKEN']?.trim() || null,
    setupTokenFile: env['SETUP_TOKEN_FILE']?.trim() || null,
    rateLimitPerMinute: readInt(env, 'AUTH_RATE_LIMIT_PER_MINUTE', 20, 1),
    devBypass,
  };
}

function loadCatalogConfig(env: Env): CatalogConfig {
  const raw = env['CATALOG_LANGUAGES']?.trim();
  const requested = raw
    ? raw.split(',').map((code) => code.trim().toLowerCase())
    : [...CATALOG_LANGUAGES];
  const invalid = requested.filter((code) => !isCatalogLanguage(code));
  if (invalid.length > 0 || requested.length === 0) {
    throw new Error(
      `CATALOG_LANGUAGES must be a comma-separated list of ${CATALOG_LANGUAGES.join(', ')} (got "${raw ?? ''}")`
    );
  }

  return {
    syncEnabled: readBool(env, 'CATALOG_SYNC_ENABLED', true),
    languages: CATALOG_LANGUAGES.filter((language) => requested.includes(language)),
    // Capped well below setTimeout's ~24.8-day limit (longer delays fire at once).
    refreshHours: readInt(env, 'CATALOG_REFRESH_HOURS', 24, 1, 168),
    fullRefreshDays: readInt(env, 'CATALOG_FULL_REFRESH_DAYS', 7, 1, 365),
    pricesRefreshHours: readInt(env, 'CATALOG_PRICES_REFRESH_HOURS', 24, 1, 168),
  };
}

/** Reads configuration from environment variables, failing fast on invalid values. */
export function loadConfig(env: Env = process.env): ServerConfig {
  const clientIpHeader = env['CLIENT_IP_HEADER']?.trim().toLowerCase();
  if (clientIpHeader && !/^[a-z0-9-]+$/.test(clientIpHeader)) {
    throw new Error(`CLIENT_IP_HEADER must be a header name (got "${clientIpHeader}")`);
  }

  const production = env['NODE_ENV']?.trim() === 'production';

  return {
    host: env['HOST']?.trim() || '0.0.0.0',
    port: readInt(env, 'PORT', 3000, 1),
    dataDir: resolve(env['DATA_DIR']?.trim() || resolve(SERVER_ROOT, 'data')),
    backupDir: resolve(env['BACKUP_DIR']?.trim() || resolve(SERVER_ROOT, 'backups')),
    backupKeep: readInt(env, 'BACKUP_KEEP', 14, 1),
    backupIntervalHours: readInt(env, 'BACKUP_INTERVAL_HOURS', 24, 0),
    trustProxyHops: readInt(env, 'TRUST_PROXY_HOPS', 0, 0),
    clientIpHeader: clientIpHeader || null,
    rateLimitPerMinute: readInt(env, 'RATE_LIMIT_PER_MINUTE', 600, 1),
    logLevel: env['LOG_LEVEL']?.trim() || 'info',
    production,
    auth: loadAuthConfig(env, production),
    catalog: loadCatalogConfig(env),
  };
}
