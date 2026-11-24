import type { CatalogRegion } from '@pokepaper/shared';
import type { Db } from '../db.js';

const VERSION_KEY = 'cardmarket_matches_version';

/**
 * Cardmarket products matched to catalog cards by hand (docs/catalog.md →
 * Matching by hand), in `pokepaper.db`'s `cardmarket_matches`: unlike
 * `catalog.db`, it's backed up, and these can't be rebuilt from TCGdex.
 */
export class CardmarketMatchStore {
  constructor(private readonly db: Db) {}

  /** The product matched to a card by hand, if any. */
  get(region: CatalogRegion, cardId: string): number | undefined {
    const row = this.db
      .prepare('SELECT id_product FROM cardmarket_matches WHERE region = ? AND card_id = ?')
      .get(region, cardId) as { id_product: number } | undefined;
    return row?.id_product;
  }

  /** Every card of a region matched by hand: its product, by card ID. */
  list(region: CatalogRegion): Map<string, number> {
    const rows = this.db
      .prepare('SELECT card_id, id_product FROM cardmarket_matches WHERE region = ?')
      .all(region) as { card_id: string; id_product: number }[];
    return new Map(rows.map((row) => [row.card_id, row.id_product]));
  }

  /** Matches a card to a product, replacing any earlier match. */
  save(region: CatalogRegion, cardId: string, idProduct: number, now = new Date()): void {
    this.db.transaction(() => {
      const { changes } = this.db
        .prepare(
          `INSERT INTO cardmarket_matches (region, card_id, id_product, matched_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (region, card_id) DO UPDATE
           SET id_product = excluded.id_product, matched_at = excluded.matched_at
           WHERE id_product IS NOT excluded.id_product`
        )
        .run(region, cardId, idProduct, now.toISOString());
      if (changes > 0) {
        this.bumpVersion();
      }
    })();
  }

  /** Forgets a card's match. Returns whether it had one. */
  remove(region: CatalogRegion, cardId: string): boolean {
    return this.db.transaction(() => {
      const { changes } = this.db
        .prepare('DELETE FROM cardmarket_matches WHERE region = ? AND card_id = ?')
        .run(region, cardId);
      if (changes > 0) {
        this.bumpVersion();
      }
      return changes > 0;
    })();
  }

  /** Bumped whenever a match changes, so the price pass applies the guide anew. */
  version(): number {
    const row = this.db.prepare('SELECT value FROM server_meta WHERE key = ?').get(VERSION_KEY) as
      { value: string } | undefined;
    return Number(row?.value ?? 0);
  }

  private bumpVersion(): void {
    this.db
      .prepare(
        `INSERT INTO server_meta (key, value) VALUES (?, '1')
         ON CONFLICT (key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`
      )
      .run(VERSION_KEY);
  }
}
