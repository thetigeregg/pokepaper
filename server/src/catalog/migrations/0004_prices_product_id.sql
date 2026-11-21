-- Price packs gained each card's Cardmarket product ID (`idProduct`), which
-- isn't stored anew: bump every region's prices version once, so devices
-- holding an older pack download it again instead of getting 304.
UPDATE catalog_meta
SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
WHERE key LIKE 'prices_version:%';
