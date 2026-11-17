-- Scans TCGdex has on its asset host but doesn't link from the card data
-- (about 38% of the unlinked Japanese ones). The import checks a card
-- language's expected path once and remembers the answer here, so later
-- runs don't ask again: hits forever, misses for 30 days.
CREATE TABLE catalog_image_probes (
  path TEXT PRIMARY KEY,
  found INTEGER NOT NULL CHECK (found IN (0, 1)),
  checked_at TEXT NOT NULL
);
