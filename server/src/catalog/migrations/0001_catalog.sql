-- Card catalogue imported from TCGdex (see docs/catalog.md). Lives in its own
-- database file (catalog.db): it can be rebuilt from TCGdex at any time, so it
-- is not part of the nightly backups.

CREATE TABLE catalog_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Bumped whenever any series, set or card changes; clients compare it to
-- decide whether anything needs downloading.
INSERT INTO catalog_meta (key, value) VALUES ('version', '0');

-- Payloads are the shared CatalogSeries / CatalogSet / CatalogCard JSON.
CREATE TABLE catalog_series (
  region TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (region, id)
);

CREATE TABLE catalog_sets (
  region TEXT NOT NULL,
  id TEXT NOT NULL,
  serie_id TEXT NOT NULL,
  release_date TEXT,
  card_count INTEGER NOT NULL,
  payload TEXT NOT NULL,
  -- SHA-256 of the set plus all its cards (canonical JSON). Changes exactly
  -- when a client's copy of the set would.
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (region, id)
);

CREATE TABLE catalog_cards (
  region TEXT NOT NULL,
  id TEXT NOT NULL,
  set_id TEXT NOT NULL,
  sort_index INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (region, id),
  FOREIGN KEY (region, set_id) REFERENCES catalog_sets (region, id) ON DELETE CASCADE
);

CREATE INDEX idx_catalog_cards_set ON catalog_cards (region, set_id, sort_index);

-- One row per import run, for diagnostics.
CREATE TABLE catalog_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('light', 'full')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'partial', 'failed', 'aborted')),
  stats TEXT
);
