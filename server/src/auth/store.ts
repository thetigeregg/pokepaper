import type { ClientKind, CredentialSummary, SessionSummary } from '@pokepaper/shared';
import type { Statement } from 'better-sqlite3';
import type { Db } from '../db.js';
import { generateId, generateSessionToken, hashToken } from './tokens.js';

export type ChallengePurpose = 'register' | 'login';

export interface StoredCredential {
  id: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[] | undefined;
}

export interface NewCredential extends StoredCredential {
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
  label: string;
}

export interface ResolvedSession {
  id: string;
  client: ClientKind;
  expiresAt: string;
  /** True when the expiry was just extended (callers refresh the cookie). */
  extended: boolean;
}

interface CredentialRow {
  id: string;
  public_key: Buffer;
  counter: number;
  transports: string | null;
  device_type: 'singleDevice' | 'multiDevice';
  backed_up: number;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

interface SessionRow {
  id: string;
  client: ClientKind;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Sliding expiry is refreshed at most this often, to avoid a write per request. */
const SESSION_TOUCH_INTERVAL_MS = 60 * 60 * 1000;
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** Persistence for passkeys, sessions, and WebAuthn challenges. */
export class AuthStore {
  private readonly statements: {
    countCredentials: Statement<[], { n: number }>;
    listCredentials: Statement<[], CredentialRow>;
    findCredential: Statement<[string], CredentialRow>;
    insertCredential: Statement<
      [string, Buffer, number, string | null, string, number, string, string]
    >;
    touchCredential: Statement<[number, string, string]>;
    deleteCredential: Statement<[string]>;
    insertSession: Statement<[string, string, ClientKind, string | null, string, string, string]>;
    findSession: Statement<[string, string], SessionRow>;
    touchSession: Statement<[string, string, string]>;
    listSessions: Statement<[string], SessionRow>;
    deleteSession: Statement<[string]>;
    pruneSessions: Statement<[string]>;
    insertChallenge: Statement<[string, ChallengePurpose, string]>;
    consumeChallenge: Statement<[string, ChallengePurpose, string], { challenge: string }>;
    pruneChallenges: Statement<[string]>;
    userId: Statement<[], { value: string }>;
  };

  constructor(
    private readonly db: Db,
    private readonly sessionTtlDays: number
  ) {
    this.statements = {
      countCredentials: db.prepare('SELECT COUNT(*) AS n FROM webauthn_credentials'),
      listCredentials: db.prepare('SELECT * FROM webauthn_credentials ORDER BY created_at'),
      findCredential: db.prepare('SELECT * FROM webauthn_credentials WHERE id = ?'),
      insertCredential: db.prepare(
        `INSERT INTO webauthn_credentials
           (id, public_key, counter, transports, device_type, backed_up, label, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ),
      touchCredential: db.prepare(
        'UPDATE webauthn_credentials SET counter = ?, last_used_at = ? WHERE id = ?'
      ),
      deleteCredential: db.prepare('DELETE FROM webauthn_credentials WHERE id = ?'),
      insertSession: db.prepare(
        `INSERT INTO sessions
           (id, token_hash, client, credential_id, created_at, last_seen_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ),
      findSession: db.prepare(
        `SELECT id, client, created_at, last_seen_at, expires_at FROM sessions
         WHERE token_hash = ? AND expires_at > ?`
      ),
      touchSession: db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?'),
      listSessions: db.prepare(
        `SELECT id, client, created_at, last_seen_at, expires_at FROM sessions
         WHERE expires_at > ? ORDER BY last_seen_at DESC`
      ),
      deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
      pruneSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
      insertChallenge: db.prepare(
        'INSERT INTO auth_challenges (challenge, purpose, expires_at) VALUES (?, ?, ?)'
      ),
      consumeChallenge: db.prepare(
        `DELETE FROM auth_challenges WHERE challenge = ? AND purpose = ? AND expires_at > ?
         RETURNING challenge`
      ),
      pruneChallenges: db.prepare('DELETE FROM auth_challenges WHERE expires_at <= ?'),
      userId: db.prepare("SELECT value FROM server_meta WHERE key = 'webauthn_user_id'"),
    };
  }

  /** The single account's WebAuthn user handle. */
  userId(): Uint8Array {
    const row = this.statements.userId.get();
    if (!row) {
      throw new Error('server_meta.webauthn_user_id is missing; was the database migrated?');
    }
    return Buffer.from(row.value, 'hex');
  }

  hasCredentials(): boolean {
    return this.credentialCount() > 0;
  }

  credentialCount(): number {
    return this.statements.countCredentials.get()?.n ?? 0;
  }

  listCredentials(): CredentialSummary[] {
    return this.statements.listCredentials.all().map(toCredentialSummary);
  }

  /** Id + transports of every passkey, for excludeCredentials during registration. */
  credentialDescriptors(): { id: string; transports?: string[] }[] {
    return this.statements.listCredentials
      .all()
      .map((row) =>
        row.transports
          ? { id: row.id, transports: JSON.parse(row.transports) as string[] }
          : { id: row.id }
      );
  }

  findCredential(id: string): StoredCredential | undefined {
    const row = this.statements.findCredential.get(id);
    return row
      ? {
          id: row.id,
          publicKey: new Uint8Array(row.public_key),
          counter: row.counter,
          transports: row.transports ? (JSON.parse(row.transports) as string[]) : undefined,
        }
      : undefined;
  }

  addCredential(credential: NewCredential, now = new Date()): CredentialSummary {
    this.statements.insertCredential.run(
      credential.id,
      Buffer.from(credential.publicKey),
      credential.counter,
      credential.transports ? JSON.stringify(credential.transports) : null,
      credential.deviceType,
      credential.backedUp ? 1 : 0,
      credential.label,
      now.toISOString()
    );
    const row = this.statements.findCredential.get(credential.id);
    if (!row) {
      throw new Error('credential insert failed');
    }
    return toCredentialSummary(row);
  }

  recordCredentialUse(id: string, counter: number, now = new Date()): void {
    this.statements.touchCredential.run(counter, now.toISOString(), id);
  }

  /** Deletes a passkey (and, via cascade, the sessions created with it). */
  deleteCredential(id: string): boolean {
    return this.statements.deleteCredential.run(id).changes > 0;
  }

  /** Creates a session and returns its bearer token (only ever returned here). */
  createSession(client: ClientKind, credentialId: string | null, now = new Date()): string {
    const token = generateSessionToken();
    const timestamp = now.toISOString();
    this.statements.pruneSessions.run(timestamp);
    this.statements.insertSession.run(
      generateId(),
      hashToken(token),
      client,
      credentialId,
      timestamp,
      timestamp,
      this.expiryFrom(now)
    );
    return token;
  }

  /** Looks up a live session by bearer token, extending its sliding expiry when due. */
  resolveSession(token: string, now = new Date()): ResolvedSession | null {
    const row = this.statements.findSession.get(hashToken(token), now.toISOString());
    if (!row) {
      return null;
    }

    if (now.getTime() - Date.parse(row.last_seen_at) < SESSION_TOUCH_INTERVAL_MS) {
      return { id: row.id, client: row.client, expiresAt: row.expires_at, extended: false };
    }

    const expiresAt = this.expiryFrom(now);
    this.statements.touchSession.run(now.toISOString(), expiresAt, row.id);
    return { id: row.id, client: row.client, expiresAt, extended: true };
  }

  listSessions(currentSessionId: string | null, now = new Date()): SessionSummary[] {
    return this.statements.listSessions.all(now.toISOString()).map((row) => ({
      id: row.id,
      client: row.client,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
      current: row.id === currentSessionId,
    }));
  }

  deleteSession(id: string): boolean {
    return this.statements.deleteSession.run(id).changes > 0;
  }

  saveChallenge(challenge: string, purpose: ChallengePurpose, now = new Date()): void {
    this.statements.pruneChallenges.run(now.toISOString());
    this.statements.insertChallenge.run(
      challenge,
      purpose,
      new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString()
    );
  }

  /** Single-use: true (and deleted) only for a live challenge issued for `purpose`. */
  consumeChallenge(challenge: string, purpose: ChallengePurpose, now = new Date()): boolean {
    return (
      this.statements.consumeChallenge.get(challenge, purpose, now.toISOString()) !== undefined
    );
  }

  /** Runs `action` in one SQLite transaction (better-sqlite3 transactions are synchronous). */
  transaction<T>(action: () => T): T {
    return this.db.transaction(action)();
  }

  private expiryFrom(now: Date): string {
    return new Date(now.getTime() + this.sessionTtlDays * DAY_MS).toISOString();
  }
}

function toCredentialSummary(row: CredentialRow): CredentialSummary {
  return {
    id: row.id,
    label: row.label,
    deviceType: row.device_type,
    backedUp: row.backed_up === 1,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}
