-- Each card's Cardmarket product ID, from TCGdex's card details (recorded
-- by the import). The daily price pass looks cards up by it in Cardmarket's
-- own price guide download, instead of fetching every card from TCGdex.
-- No foreign key, like catalog_prices: writeSet deletes and re-inserts cards.
CREATE TABLE catalog_cardmarket_products (
  region TEXT NOT NULL,
  card_id TEXT NOT NULL,
  id_product INTEGER NOT NULL CHECK (id_product > 0),
  PRIMARY KEY (region, card_id)
);

-- Start from the IDs the TCGdex price pass already stored with each price.
INSERT INTO catalog_cardmarket_products (region, card_id, id_product)
SELECT region, card_id, json_extract(payload, '$.idProduct')
FROM catalog_prices
WHERE json_type(payload, '$.idProduct') = 'integer'
  AND json_extract(payload, '$.idProduct') > 0;
