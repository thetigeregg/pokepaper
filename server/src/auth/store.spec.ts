import { memoryDb } from '../test-helpers.js';
import { AuthStore, CHALLENGE_TTL_MS, type NewCredential } from './store.js';
import { hashToken } from './tokens.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function credential(overrides: Partial<NewCredential> = {}): NewCredential {
  return {
    id: 'cred-1',
    publicKey: new Uint8Array([1, 2, 3]),
    counter: 0,
    transports: ['internal', 'hybrid'],
    deviceType: 'multiDevice',
    backedUp: true,
    label: 'iPhone',
    ...overrides,
  };
}

describe('AuthStore', () => {
  let db: ReturnType<typeof memoryDb>;
  let store: AuthStore;
  const t0 = new Date('2026-01-01T00:00:00.000Z');

  beforeEach(() => {
    db = memoryDb();
    store = new AuthStore(db, 90);
  });

  describe('credentials', () => {
    it('adds, finds, lists, and describes passkeys', () => {
      expect(store.hasCredentials()).toBe(false);

      const summary = store.addCredential(credential(), t0);

      expect(summary).toEqual({
        id: 'cred-1',
        label: 'iPhone',
        deviceType: 'multiDevice',
        backedUp: true,
        createdAt: t0.toISOString(),
        lastUsedAt: null,
      });
      expect(store.hasCredentials()).toBe(true);
      expect(store.credentialCount()).toBe(1);
      expect(store.findCredential('cred-1')).toEqual({
        id: 'cred-1',
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
        transports: ['internal', 'hybrid'],
      });
      expect(store.findCredential('missing')).toBeUndefined();
      expect(store.credentialDescriptors()).toEqual([
        { id: 'cred-1', transports: ['internal', 'hybrid'] },
      ]);
      expect(store.listCredentials()).toEqual([summary]);
    });

    it('stores passkeys without transports', () => {
      store.addCredential(credential({ transports: undefined }));

      expect(store.findCredential('cred-1')?.transports).toBeUndefined();
      expect(store.credentialDescriptors()).toEqual([{ id: 'cred-1' }]);
    });

    it('records use (counter + last used)', () => {
      store.addCredential(credential());

      store.recordCredentialUse('cred-1', 7, t0);

      expect(store.findCredential('cred-1')?.counter).toBe(7);
      expect(store.listCredentials()[0]?.lastUsedAt).toBe(t0.toISOString());
    });

    it('deleting a passkey signs out the sessions created with it', () => {
      store.addCredential(credential());
      store.addCredential(credential({ id: 'cred-2' }));
      const doomed = store.createSession('web', 'cred-1');
      const kept = store.createSession('ios', 'cred-2');

      expect(store.deleteCredential('cred-1')).toBe(true);
      expect(store.deleteCredential('cred-1')).toBe(false);

      expect(store.resolveSession(doomed)).toBeNull();
      expect(store.resolveSession(kept)).not.toBeNull();
    });
  });

  describe('sessions', () => {
    it('stores only a hash of the token', () => {
      const token = store.createSession('web', null, t0);

      const rows = db.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[];
      expect(rows).toEqual([{ token_hash: hashToken(token) }]);
      expect(JSON.stringify(rows)).not.toContain(token);
    });

    it('resolves a live session and rejects unknown or expired ones', () => {
      const token = store.createSession('ios', null, t0);

      expect(store.resolveSession(token, t0)).toMatchObject({ client: 'ios', extended: false });
      expect(store.resolveSession('nope', t0)).toBeNull();
      expect(store.resolveSession(token, new Date(t0.getTime() + 91 * DAY))).toBeNull();
    });

    it('slides the expiry forward at most hourly', () => {
      const token = store.createSession('web', null, t0);

      const soon = store.resolveSession(token, new Date(t0.getTime() + 10 * 60 * 1000));
      expect(soon?.extended).toBe(false);
      expect(soon?.expiresAt).toBe(new Date(t0.getTime() + 90 * DAY).toISOString());

      const later = new Date(t0.getTime() + 2 * HOUR);
      const extended = store.resolveSession(token, later);
      expect(extended?.extended).toBe(true);
      expect(extended?.expiresAt).toBe(new Date(later.getTime() + 90 * DAY).toISOString());

      // A session used regularly never expires.
      expect(store.resolveSession(token, new Date(later.getTime() + 89 * DAY))).not.toBeNull();
    });

    it('lists live sessions with the current one flagged, and deletes by id', () => {
      const first = store.createSession('web', null, t0);
      store.createSession('ios', null, new Date(t0.getTime() + HOUR));
      const current = store.resolveSession(first, t0);

      const sessions = store.listSessions(current?.id ?? null, t0);
      expect(sessions).toHaveLength(2);
      expect(sessions.filter((s) => s.current).map((s) => s.client)).toEqual(['web']);

      expect(store.deleteSession(current?.id ?? '')).toBe(true);
      expect(store.deleteSession('missing')).toBe(false);
      expect(store.resolveSession(first, t0)).toBeNull();
    });

    it('prunes expired sessions when a new one is created', () => {
      store.createSession('web', null, t0);

      store.createSession('web', null, new Date(t0.getTime() + 100 * DAY));

      expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 1 });
    });
  });

  describe('challenges', () => {
    it('are single-use and bound to their purpose', () => {
      store.saveChallenge('abc', 'login', t0);

      expect(store.consumeChallenge('abc', 'register', t0)).toBe(false);
      expect(store.consumeChallenge('abc', 'login', t0)).toBe(true);
      expect(store.consumeChallenge('abc', 'login', t0)).toBe(false);
    });

    it('expire', () => {
      store.saveChallenge('abc', 'register', t0);

      expect(
        store.consumeChallenge('abc', 'register', new Date(t0.getTime() + CHALLENGE_TTL_MS + 1))
      ).toBe(false);
    });

    it('prunes expired challenges when a new one is saved', () => {
      store.saveChallenge('old', 'login', t0);

      store.saveChallenge('new', 'login', new Date(t0.getTime() + CHALLENGE_TTL_MS + 1));

      expect(db.prepare('SELECT challenge FROM auth_challenges').all()).toEqual([
        { challenge: 'new' },
      ]);
    });
  });

  it('exposes a stable 16-byte WebAuthn user handle', () => {
    expect(store.userId()).toHaveLength(16);
    expect(store.userId()).toEqual(store.userId());
  });

  it('refuses a database without a user handle', () => {
    db.prepare("DELETE FROM server_meta WHERE key = 'webauthn_user_id'").run();

    expect(() => store.userId()).toThrow(/webauthn_user_id is missing/);
  });

  it('rolls back a failed transaction', () => {
    expect(() =>
      store.transaction(() => {
        store.addCredential(credential());
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(store.hasCredentials()).toBe(false);
  });
});
