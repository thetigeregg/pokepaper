import { resolve } from 'node:path';

export interface ServerConfig {
  host: string;
  port: number;
  /** Directory holding the SQLite database (`pokepaper.db`). */
  dataDir: string;
  /** Directory for `VACUUM INTO` database snapshots. */
  backupDir: string;
  /** Snapshots kept; older ones are deleted after each backup. */
  backupKeep: number;
  /** Hours between scheduled backups (one also runs at startup). 0 disables the schedule. */
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
}

type Env = Record<string, string | undefined>;

const SERVER_ROOT = resolve(import.meta.dirname, '..');

function readInt(env: Env, key: string, fallback: number, min: number): number {
  const raw = env[key]?.trim();
  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${key} must be an integer >= ${String(min)} (got "${raw}")`);
  }

  return value;
}

/** Reads configuration from environment variables, failing fast on invalid values. */
export function loadConfig(env: Env = process.env): ServerConfig {
  const clientIpHeader = env['CLIENT_IP_HEADER']?.trim().toLowerCase();
  if (clientIpHeader && !/^[a-z0-9-]+$/.test(clientIpHeader)) {
    throw new Error(`CLIENT_IP_HEADER must be a header name (got "${clientIpHeader}")`);
  }

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
  };
}
