-- Cardmarket products matched to catalog cards by hand, in the app's
-- matcher (docs/catalog.md → Matching by hand), for cards TCGdex doesn't map.
-- Kept here rather than in catalog.db, which is rebuilt from TCGdex and not
-- backed up: these can't be rebuilt. A match wins over TCGdex's product.
-- No foreign key: catalog cards live in catalog.db.
CREATE TABLE cardmarket_matches (
  region TEXT NOT NULL,
  card_id TEXT NOT NULL,
  id_product INTEGER NOT NULL CHECK (id_product > 0),
  matched_at TEXT NOT NULL,
  PRIMARY KEY (region, card_id)
);
