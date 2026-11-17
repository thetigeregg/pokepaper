-- Passkey authentication (see docs/auth.md). Single user: every credential
-- belongs to the one account, identified by server_meta.webauthn_user_id.

INSERT INTO server_meta (key, value) VALUES ('webauthn_user_id', lower(hex(randomblob(16))));

CREATE TABLE webauthn_credentials (
  id TEXT PRIMARY KEY,                 -- base64url credential ID
  public_key BLOB NOT NULL,            -- COSE public key
  counter INTEGER NOT NULL,
  transports TEXT,                     -- JSON array of AuthenticatorTransport
  device_type TEXT NOT NULL CHECK (device_type IN ('singleDevice', 'multiDevice')),
  backed_up INTEGER NOT NULL CHECK (backed_up IN (0, 1)),
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

-- `id` is a random public identifier (safe to list and revoke by); the
-- bearer secret is only ever stored as a SHA-256 hash. Deleting a passkey
-- signs out the sessions created with it.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  client TEXT NOT NULL CHECK (client IN ('web', 'ios')),
  credential_id TEXT REFERENCES webauthn_credentials (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_expires_at ON sessions (expires_at);

-- Outstanding WebAuthn challenges. Single-use: verification deletes the row.
CREATE TABLE auth_challenges (
  challenge TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
  expires_at TEXT NOT NULL
);
