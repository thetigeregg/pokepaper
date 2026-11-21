-- Cardmarket prices from TCGdex (see docs/catalog.md → Prices). Kept apart
-- from catalog_cards so daily price changes never touch set hashes: clients
-- download prices as one pack per region instead.
--
-- No foreign key to catalog_cards: writing a set deletes and re-inserts its
-- cards, which would cascade here. The price pass prunes rows for cards the
-- catalog no longer has.
CREATE TABLE catalog_prices (
  region TEXT NOT NULL,
  card_id TEXT NOT NULL,
  -- Every Cardmarket figure TCGdex reports (StoredCardPrices in price-data.ts).
  payload TEXT NOT NULL,
  PRIMARY KEY (region, card_id)
);

-- One row per price pass, for diagnostics and scheduling.
CREATE TABLE catalog_price_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'partial', 'failed', 'aborted')),
  stats TEXT
);
