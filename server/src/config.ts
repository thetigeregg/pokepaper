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
   * Trust X-Forwarded-* headers. On in production, where the server only
   * ever sees traffic from edge (Caddy) behind Nginx Proxy Manager.
   */
  trustProxy: boolean;
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

/** Reads configuration from environment variables, failing fast on invalid values. */
export function loadConfig(env: Env = process.env): ServerConfig {
  return {
    host: env['HOST']?.trim() || '0.0.0.0',
    port: readInt(env, 'PORT', 3000, 1),
    dataDir: resolve(env['DATA_DIR']?.trim() || resolve(SERVER_ROOT, 'data')),
    backupDir: resolve(env['BACKUP_DIR']?.trim() || resolve(SERVER_ROOT, 'backups')),
    backupKeep: readInt(env, 'BACKUP_KEEP', 14, 1),
    backupIntervalHours: readInt(env, 'BACKUP_INTERVAL_HOURS', 24, 0),
    trustProxy: readBool(env, 'TRUST_PROXY', false),
    rateLimitPerMinute: readInt(env, 'RATE_LIMIT_PER_MINUTE', 600, 1),
    logLevel: env['LOG_LEVEL']?.trim() || 'info',
  };
}
