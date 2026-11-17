-- Local-first sync storage (see docs/sync.md).

-- Identifies this physical copy of the database. Every backup snapshot gets
-- a fresh value when it's written, so restoring one presents a new epoch to
-- clients, whose cursors then no longer match and they re-pull from scratch.
CREATE TABLE server_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO server_meta (key, value) VALUES ('epoch', lower(hex(randomblob(8))));

-- Current state of every synced entity, doubling as the compacted change
-- log: each write replaces the entity's row with a fresh `seq`, so pulling
-- from the start returns roughly the current state, not history. Deletes are
-- kept as tombstones (operation = 'delete', payload NULL) so clients that
-- synced before the delete still learn about it.
CREATE TABLE entity_changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
  payload TEXT,
  client_timestamp TEXT NOT NULL,
  server_timestamp TEXT NOT NULL,
  UNIQUE (entity_type, entity_id)
);

-- Idempotency record of applied opIds. Rejections are not recorded: they're
-- re-validated on every attempt, so a newer server can accept an op an older
-- one rejected.
CREATE TABLE applied_operations (
  op_id TEXT PRIMARY KEY,
  processed_at TEXT NOT NULL
);
