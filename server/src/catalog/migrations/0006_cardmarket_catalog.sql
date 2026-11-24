-- Cardmarket's own catalog, for matching cards to products by hand
-- (docs/catalog.md → Matching by hand). Both tables are caches of
-- Cardmarket downloads, rebuilt whole each time.

-- Its single cards (`products_singles_6.json`), downloaded when the matcher
-- needs them. `match_name` is the name without the attacks in brackets and
-- `search_text` the whole name, both lowercased with only letters and digits
-- kept (cardmarketSearchText), so "MMewtwo EX" and "M Mewtwo EX" compare equal.
CREATE TABLE cardmarket_products (
  id_product INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  id_expansion INTEGER NOT NULL,
  date_added TEXT,
  match_name TEXT NOT NULL,
  search_text TEXT NOT NULL
);
CREATE INDEX idx_cardmarket_products_expansion ON cardmarket_products (id_expansion, match_name);
CREATE INDEX idx_cardmarket_products_match_name ON cardmarket_products (match_name);

-- The price guide the price pass last applied, one entry per product as
-- Cardmarket sends it, so the matcher can show any product's prices and
-- price a card as soon as it's matched.
CREATE TABLE cardmarket_price_guide (
  id_product INTEGER PRIMARY KEY,
  entry TEXT NOT NULL
);

-- Forget the guide last applied, so the next price pass downloads it whole
-- (no 304) and fills cardmarket_price_guide.
DELETE FROM catalog_meta WHERE key = 'price_guide';
