-- Local-first sync storage (see docs/sync.md).

-- Current state of every synced entity, doubling as the compacted change
-- log: each applied operation replaces the entity's row with a fresh `seq`,
-- so pulling from cursor 0 returns roughly the current state, not history.
-- Deletes are kept as tombstones (operation = 'delete', payload NULL) so
-- clients that synced before the delete still learn about it.
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

-- Idempotency record: every processed opId and the result returned for it.
CREATE TABLE applied_operations (
  op_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('applied', 'failed')),
  message TEXT,
  processed_at TEXT NOT NULL
);
