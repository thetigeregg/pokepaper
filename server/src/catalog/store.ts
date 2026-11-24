import { createHash } from 'node:crypto';
import type {
  CatalogCard,
  CatalogCardPrices,
  CatalogLanguage,
  CatalogManifest,
  CatalogPricePack,
  CatalogRegion,
  CatalogSeries,
  CatalogSet,
  CatalogSetPack,
  ExchangeRates,
} from '@pokepaper/shared';
import type { Db } from '../db.js';
import { toWirePrices, type StoredCardPrices } from './price-data.js';

/** The Cardmarket price guide download last applied. */
export interface PriceGuideState {
  /** Its HTTP ETag, sent back so an unchanged guide costs an empty 304. */
  etag: string | null;
  /** When Cardmarket generated it (ISO timestamp). */
  createdAt: string;
  /** The products version it was applied with: products changed since, it's applied anew. */
  productsVersion: number;
  /** Likewise, the version of the matches made by hand (`CardmarketMatchStore.version`). */
  matchesVersion: number;
}

/** A single card in Cardmarket's product list (`products_singles_6.json`). */
export interface CardmarketProduct {
  idProduct: number;
  /** With the attacks that tell printings apart in brackets: `MMewtwo EX [Vanishing Strike]`. */
  name: string;
  idExpansion: number;
  /** When Cardmarket added it (`YYYY-MM-DD`); null when unknown (it reports `0000-00-00`). */
  dateAdded: string | null;
}

/** The Cardmarket product list download stored last. */
export interface CardmarketProductsState {
  /** Its HTTP ETag, sent back so an unchanged list costs an empty 304. */
  etag: string | null;
  /** When Cardmarket generated it (ISO timestamp). */
  createdAt: string;
  /** When it was last downloaded or found unchanged (ISO timestamp). */
  checkedAt: string;
}

/** `CatalogStore.findCardmarketProducts` filters; each one given must hold. */
export interface CardmarketProductFilter {
  /** `cardmarketMatchName` of the name is one of these. */
  matchNames?: readonly string[];
  /** `cardmarketSearchText` of the name contains this. */
  contains?: string;
  /** In one of these expansions. */
  expansions?: readonly number[];
  /** Not a filter: products in these expansions come first, flagged `inSet`. */
  prefer?: readonly number[];
}

interface CardmarketProductRow {
  id_product: number;
  name: string;
  id_expansion: number;
  date_added: string | null;
}

function toCardmarketProduct(row: CardmarketProductRow): CardmarketProduct {
  return {
    idProduct: row.id_product,
    name: row.name,
    idExpansion: row.id_expansion,
    dateAdded: row.date_added,
  };
}

/**
 * A name as the matcher compares it: lowercased, accents dropped, only
 * letters and digits kept, so Cardmarket's "MMewtwo EX" and TCGdex's
 * "M Mewtwo EX" (or "Mewtwo-EX") are equal.
 */
export function cardmarketSearchText(name: string): string {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** `cardmarketSearchText` of a product name without its bracketed attacks. */
export function cardmarketMatchName(name: string): string {
  return cardmarketSearchText(name.replace(/\[[^\]]*\]/g, ''));
}

export type CatalogRunKind = 'light' | 'full';
export type CatalogRunStatus = 'ok' | 'partial' | 'failed' | 'aborted';

/** JSON with object keys sorted at every level, so equal content always hashes equally. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner === null || typeof inner !== 'object' || Array.isArray(inner)) {
      return inner;
    }
    const record = inner as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, record[key]])
    );
  });
}

/** Content hash of a set as clients receive it: the set plus its cards in display order. */
export function setContentHash(set: CatalogSet, cards: readonly CatalogCard[]): string {
  const ordered = [...cards].sort((a, b) => a.sortIndex - b.sortIndex);
  return createHash('sha256')
    .update(stableStringify({ set, cards: ordered }))
    .digest('hex');
}

/** Persistence for the imported catalog (`catalog.db`). */
export class CatalogStore {
  constructor(private readonly db: Db) {}

  /** Bumped whenever any series, set or card changes. */
  version(): number {
    const row = this.db.prepare("SELECT value FROM catalog_meta WHERE key = 'version'").get() as
      { value: string } | undefined;
    return Number(row?.value ?? 0);
  }

  listSetIds(region: CatalogRegion): string[] {
    return (
      this.db.prepare('SELECT id FROM catalog_sets WHERE region = ?').all(region) as {
        id: string;
      }[]
    ).map((row) => row.id);
  }

  getSet(region: CatalogRegion, id: string): { set: CatalogSet; hash: string } | undefined {
    const row = this.db
      .prepare('SELECT payload, content_hash FROM catalog_sets WHERE region = ? AND id = ?')
      .get(region, id) as { payload: string; content_hash: string } | undefined;
    return row ? { set: JSON.parse(row.payload) as CatalogSet, hash: row.content_hash } : undefined;
  }

  /** The set's cards in display order. */
  listSetCards(region: CatalogRegion, setId: string): CatalogCard[] {
    return (
      this.db
        .prepare(
          'SELECT payload FROM catalog_cards WHERE region = ? AND set_id = ? ORDER BY sort_index'
        )
        .all(region, setId) as { payload: string }[]
    ).map((row) => JSON.parse(row.payload) as CatalogCard);
  }

  /** A region's Energy cards with their sets' release dates (for borrowed basic Energy scans). */
  listEnergyCards(region: CatalogRegion): { card: CatalogCard; releaseDate: string | null }[] {
    return (
      this.db
        .prepare(
          `SELECT c.payload, s.release_date FROM catalog_cards c
           JOIN catalog_sets s ON s.region = c.region AND s.id = c.set_id
           WHERE c.region = ? AND json_extract(c.payload, '$.category') = 'Energy'`
        )
        .all(region) as { payload: string; release_date: string | null }[]
    ).map((row) => ({
      card: JSON.parse(row.payload) as CatalogCard,
      releaseDate: row.release_date,
    }));
  }

  getCard(region: CatalogRegion, id: string): CatalogCard | undefined {
    const row = this.db
      .prepare('SELECT payload FROM catalog_cards WHERE region = ? AND id = ?')
      .get(region, id) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as CatalogCard) : undefined;
  }

  /** A card's image path in one language, without parsing the whole card. */
  getCardImage(region: CatalogRegion, id: string, language: CatalogLanguage): string | null {
    const row = this.db
      .prepare(
        'SELECT json_extract(payload, ?) AS image FROM catalog_cards WHERE region = ? AND id = ?'
      )
      .get(`$.text."${language}".image`, region, id) as { image: unknown } | undefined;
    return typeof row?.image === 'string' ? row.image : null;
  }

  /** A set's content hash, without loading it. */
  getSetHash(region: CatalogRegion, id: string): string | undefined {
    const row = this.db
      .prepare('SELECT content_hash FROM catalog_sets WHERE region = ? AND id = ?')
      .get(region, id) as { content_hash: string } | undefined;
    return row?.content_hash;
  }

  /** Everything a client needs to decide which sets to download. */
  manifest(languages: CatalogLanguage[]): CatalogManifest {
    // One read transaction: a consistent snapshot even while an import writes.
    return this.db.transaction(() => this.readManifest(languages))();
  }

  private readManifest(languages: CatalogLanguage[]): CatalogManifest {
    const series = (
      this.db.prepare('SELECT payload FROM catalog_series ORDER BY region, id').all() as {
        payload: string;
      }[]
    ).map((row) => JSON.parse(row.payload) as CatalogSeries);
    const sets = this.db
      .prepare(
        'SELECT region, id, content_hash AS hash, card_count AS cardCount FROM catalog_sets ORDER BY region, release_date, id'
      )
      .all() as CatalogManifest['sets'];
    return { version: this.version(), languages, series, sets };
  }

  /** A set with its cards in display order, or undefined if unknown. */
  getSetPack(region: CatalogRegion, id: string): CatalogSetPack | undefined {
    // One read transaction, so the hash always matches the cards returned.
    return this.db.transaction(() => {
      const stored = this.getSet(region, id);
      return stored
        ? { hash: stored.hash, set: stored.set, cards: this.listSetCards(region, id) }
        : undefined;
    })();
  }

  /** What an earlier check found at an asset path, if it was checked. */
  getImageProbe(path: string): { found: boolean; checkedAt: Date } | undefined {
    const row = this.db
      .prepare('SELECT found, checked_at FROM catalog_image_probes WHERE path = ?')
      .get(path) as { found: number; checked_at: string } | undefined;
    return row ? { found: row.found === 1, checkedAt: new Date(row.checked_at) } : undefined;
  }

  saveImageProbe(path: string, found: boolean, now = new Date()): void {
    this.db
      .prepare(
        `INSERT INTO catalog_image_probes (path, found, checked_at) VALUES (?, ?, ?)
         ON CONFLICT (path) DO UPDATE SET found = excluded.found, checked_at = excluded.checked_at`
      )
      .run(path, found ? 1 : 0, now.toISOString());
  }

  /**
   * Replaces a set and all of its cards atomically. Cards not in `cards` are
   * removed. Returns false (writing nothing) when the content is unchanged.
   */
  writeSet(set: CatalogSet, cards: readonly CatalogCard[], now = new Date()): boolean {
    const hash = setContentHash(set, cards);
    if (this.getSetHash(set.region, set.id) === hash) {
      return false;
    }

    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO catalog_sets
             (region, id, serie_id, release_date, card_count, payload, content_hash, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (region, id) DO UPDATE SET
             serie_id = excluded.serie_id, release_date = excluded.release_date,
             card_count = excluded.card_count, payload = excluded.payload,
             content_hash = excluded.content_hash, updated_at = excluded.updated_at`
        )
        .run(
          set.region,
          set.id,
          set.serieId,
          set.releaseDate,
          cards.length,
          JSON.stringify(set),
          hash,
          now.toISOString()
        );

      this.db
        .prepare('DELETE FROM catalog_cards WHERE region = ? AND set_id = ?')
        .run(set.region, set.id);
      const insert = this.db.prepare(
        `INSERT INTO catalog_cards (region, id, set_id, sort_index, payload) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (region, id) DO UPDATE SET
           set_id = excluded.set_id, sort_index = excluded.sort_index, payload = excluded.payload`
      );
      for (const card of cards) {
        insert.run(card.region, card.id, card.setId, card.sortIndex, JSON.stringify(card));
      }

      this.bumpVersion();
    })();
    return true;
  }

  /** Removes a set and its cards. Returns false if it didn't exist. */
  deleteSet(region: CatalogRegion, id: string): boolean {
    return this.db.transaction(() => {
      const { changes } = this.db
        .prepare('DELETE FROM catalog_sets WHERE region = ? AND id = ?')
        .run(region, id);
      if (changes > 0) {
        this.bumpVersion();
      }
      return changes > 0;
    })();
  }

  listSeries(region: CatalogRegion): CatalogSeries[] {
    return (
      this.db.prepare('SELECT payload FROM catalog_series WHERE region = ?').all(region) as {
        payload: string;
      }[]
    ).map((row) => JSON.parse(row.payload) as CatalogSeries);
  }

  /** Makes a region's series exactly `series`. Returns true if anything changed. */
  replaceSeries(region: CatalogRegion, series: readonly CatalogSeries[]): boolean {
    return this.db.transaction(() => {
      const existing = new Map(
        (
          this.db
            .prepare('SELECT id, payload FROM catalog_series WHERE region = ?')
            .all(region) as {
            id: string;
            payload: string;
          }[]
        ).map((row) => [row.id, row.payload])
      );

      let changed = false;
      const upsert = this.db.prepare(
        `INSERT INTO catalog_series (region, id, payload) VALUES (?, ?, ?)
         ON CONFLICT (region, id) DO UPDATE SET payload = excluded.payload`
      );
      for (const entry of series) {
        const payload = JSON.stringify(entry);
        if (existing.get(entry.id) !== payload) {
          upsert.run(region, entry.id, payload);
          changed = true;
        }
        existing.delete(entry.id);
      }

      const remove = this.db.prepare('DELETE FROM catalog_series WHERE region = ? AND id = ?');
      for (const id of existing.keys()) {
        remove.run(region, id);
        changed = true;
      }

      if (changed) {
        this.bumpVersion();
      }
      return changed;
    })();
  }

  /**
   * Localized → canonical (English) vocabulary learned from cards that exist
   * in both, used for cards TCGdex has only in another language.
   */
  getVocabulary(language: string): Map<string, string> {
    const row = this.db
      .prepare('SELECT value FROM catalog_meta WHERE key = ?')
      .get(`vocabulary:${language}`) as { value: string } | undefined;
    return new Map(Object.entries(row ? (JSON.parse(row.value) as Record<string, string>) : {}));
  }

  saveVocabulary(language: string, vocabulary: ReadonlyMap<string, string>): void {
    this.db
      .prepare(
        `INSERT INTO catalog_meta (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`
      )
      .run(`vocabulary:${language}`, stableStringify(Object.fromEntries(vocabulary)));
  }

  /** The ECB rates last stored (`catalog_meta` key `exchange_rates`), if any. */
  getExchangeRates(): ExchangeRates | undefined {
    const row = this.db
      .prepare("SELECT value FROM catalog_meta WHERE key = 'exchange_rates'")
      .get() as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as ExchangeRates) : undefined;
  }

  saveExchangeRates(rates: ExchangeRates): void {
    this.db
      .prepare(
        `INSERT INTO catalog_meta (key, value) VALUES ('exchange_rates', ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`
      )
      .run(stableStringify(rates));
  }

  startRun(kind: CatalogRunKind, now = new Date()): number {
    const { lastInsertRowid } = this.db
      .prepare("INSERT INTO catalog_runs (kind, started_at, status) VALUES (?, ?, 'running')")
      .run(kind, now.toISOString());
    return Number(lastInsertRowid);
  }

  finishRun(id: number, status: CatalogRunStatus, stats: object, now = new Date()): void {
    this.db
      .prepare('UPDATE catalog_runs SET status = ?, stats = ?, finished_at = ? WHERE id = ?')
      .run(status, JSON.stringify(stats), now.toISOString(), id);
  }

  /** Most recent runs first (diagnostics). */
  listRuns(limit = 20): { id: number; kind: CatalogRunKind; status: string; startedAt: string }[] {
    return this.db
      .prepare(
        'SELECT id, kind, status, started_at AS startedAt FROM catalog_runs ORDER BY id DESC LIMIT ?'
      )
      .all(limit) as { id: number; kind: CatalogRunKind; status: string; startedAt: string }[];
  }

  /** Imports and price passes left `running` by a process that died mid-run. */
  abandonRunningRuns(now = new Date()): void {
    for (const table of ['catalog_runs', 'catalog_price_runs']) {
      this.db
        .prepare(`UPDATE ${table} SET status = 'aborted', finished_at = ? WHERE status = 'running'`)
        .run(now.toISOString());
    }
  }

  /**
   * When the last full refresh finished. A `partial` one counts: the sets it
   * missed keep their previous data until the next full refresh, and
   * re-running one every cycle while TCGdex is flaky would only add load.
   */
  lastCompletedFullRun(): Date | null {
    const row = this.db
      .prepare(
        "SELECT MAX(finished_at) AS at FROM catalog_runs WHERE kind = 'full' AND status IN ('ok', 'partial')"
      )
      .get() as { at: string | null };
    return row.at ? new Date(row.at) : null;
  }

  /** Bumped whenever any of a region's prices change (`catalog_meta` key `prices_version:<region>`). */
  pricesVersion(region: CatalogRegion): number {
    const row = this.db
      .prepare('SELECT value FROM catalog_meta WHERE key = ?')
      .get(`prices_version:${region}`) as { value: string } | undefined;
    return Number(row?.value ?? 0);
  }

  /** A card's stored prices (every figure TCGdex reports), if it has any. */
  getCardPrices(region: CatalogRegion, cardId: string): StoredCardPrices | undefined {
    const row = this.db
      .prepare('SELECT payload FROM catalog_prices WHERE region = ? AND card_id = ?')
      .get(region, cardId) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as StoredCardPrices) : undefined;
  }

  /**
   * Stores fetched prices in one transaction: `null` removes a card's prices
   * (Cardmarket doesn't price it). Bumps the region's prices version when
   * anything changed. Returns the number of cards that changed.
   */
  writeCardPrices(
    region: CatalogRegion,
    entries: readonly { cardId: string; prices: StoredCardPrices | null }[]
  ): number {
    return this.db.transaction(() => {
      const read = this.db.prepare(
        'SELECT payload FROM catalog_prices WHERE region = ? AND card_id = ?'
      );
      const upsert = this.db.prepare(
        `INSERT INTO catalog_prices (region, card_id, payload) VALUES (?, ?, ?)
         ON CONFLICT (region, card_id) DO UPDATE SET payload = excluded.payload`
      );
      const remove = this.db.prepare('DELETE FROM catalog_prices WHERE region = ? AND card_id = ?');
      let changed = 0;
      for (const { cardId, prices } of entries) {
        const stored = read.get(region, cardId) as { payload: string } | undefined;
        if (prices === null) {
          if (stored) {
            remove.run(region, cardId);
            changed += 1;
          }
          continue;
        }
        const payload = JSON.stringify(prices);
        if (stored?.payload !== payload) {
          upsert.run(region, cardId, payload);
          changed += 1;
        }
      }
      if (changed > 0) {
        this.bumpPricesVersion(region);
      }
      return changed;
    })();
  }

  /** Every card ID of a region, in no particular order. */
  listCardIds(region: CatalogRegion): string[] {
    return (
      this.db.prepare('SELECT id FROM catalog_cards WHERE region = ?').all(region) as {
        id: string;
      }[]
    ).map((row) => row.id);
  }

  /** Runs `work` in one transaction (nested store writes join it). */
  transaction<T>(work: () => T): T {
    return this.db.transaction(work)();
  }

  /**
   * Records the Cardmarket product of cards (from TCGdex's card details), in
   * one transaction. `null` forgets a card's product, and its prices with
   * it: the price pass leaves cards without a product alone. Bumps the
   * products version when anything changed; returns how many cards did.
   */
  saveCardmarketProducts(
    region: CatalogRegion,
    products: ReadonlyMap<string, number | null>
  ): number {
    return this.db.transaction(() => {
      const upsert = this.db.prepare(
        `INSERT INTO catalog_cardmarket_products (region, card_id, id_product) VALUES (?, ?, ?)
         ON CONFLICT (region, card_id) DO UPDATE SET id_product = excluded.id_product
         WHERE id_product IS NOT excluded.id_product`
      );
      const remove = this.db.prepare(
        'DELETE FROM catalog_cardmarket_products WHERE region = ? AND card_id = ?'
      );
      const removePrices = this.db.prepare(
        'DELETE FROM catalog_prices WHERE region = ? AND card_id = ?'
      );
      let changed = 0;
      let pricesRemoved = 0;
      for (const [cardId, idProduct] of products) {
        if (idProduct === null) {
          changed += remove.run(region, cardId).changes;
          pricesRemoved += removePrices.run(region, cardId).changes;
        } else {
          changed += upsert.run(region, cardId, idProduct).changes;
        }
      }
      if (pricesRemoved > 0) {
        this.bumpPricesVersion(region);
      }
      if (changed > 0) {
        this.db
          .prepare(
            `INSERT INTO catalog_meta (key, value) VALUES ('products_version', '1')
             ON CONFLICT (key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`
          )
          .run();
      }
      return changed;
    })();
  }

  /** Bumped whenever any card's Cardmarket product changes (`catalog_meta` key `products_version`). */
  productsVersion(): number {
    const row = this.db
      .prepare("SELECT value FROM catalog_meta WHERE key = 'products_version'")
      .get() as { value: string } | undefined;
    return Number(row?.value ?? 0);
  }

  /**
   * Cards of a region without a known Cardmarket product whose set was
   * released on or after `releasedSince` (`YYYY-MM-DD`), or has no date.
   */
  listUnmappedCards(region: CatalogRegion, releasedSince: string): CatalogCard[] {
    return (
      this.db
        .prepare(
          `SELECT c.payload FROM catalog_cards c
           JOIN catalog_sets s ON s.region = c.region AND s.id = c.set_id
           WHERE c.region = ? AND (s.release_date IS NULL OR s.release_date >= ?)
             AND NOT EXISTS (
               SELECT 1 FROM catalog_cardmarket_products p
               WHERE p.region = c.region AND p.card_id = c.id
             )`
        )
        .all(region, releasedSince) as { payload: string }[]
    ).map((row) => JSON.parse(row.payload) as CatalogCard);
  }

  /** The Cardmarket product of each of a region's cards that has one, by card ID. */
  listCardmarketProducts(region: CatalogRegion): Map<string, number> {
    const rows = this.db
      .prepare(
        `SELECT p.card_id, p.id_product FROM catalog_cardmarket_products p
         JOIN catalog_cards c ON c.region = p.region AND c.id = p.card_id
         WHERE p.region = ?`
      )
      .all(region) as { card_id: string; id_product: number }[];
    return new Map(rows.map((row) => [row.card_id, row.id_product]));
  }

  /** Forgets the products of cards the catalog no longer has. Returns how many. */
  pruneOrphanProducts(region: CatalogRegion): number {
    return this.db
      .prepare(
        `DELETE FROM catalog_cardmarket_products WHERE region = ? AND NOT EXISTS (
           SELECT 1 FROM catalog_cards c
           WHERE c.region = catalog_cardmarket_products.region AND c.id = catalog_cardmarket_products.card_id
         )`
      )
      .run(region).changes;
  }

  /** The Cardmarket product TCGdex reports for a card, if any. */
  getCardmarketProductOf(region: CatalogRegion, cardId: string): number | undefined {
    const row = this.db
      .prepare(
        'SELECT id_product FROM catalog_cardmarket_products WHERE region = ? AND card_id = ?'
      )
      .get(region, cardId) as { id_product: number } | undefined;
    return row?.id_product;
  }

  /**
   * Replaces the stored copy of Cardmarket's product list (single cards) in
   * one transaction, with the download it came from.
   */
  replaceCardmarketProducts(
    products: readonly CardmarketProduct[],
    state: CardmarketProductsState
  ): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM cardmarket_products').run();
      const insert = this.db.prepare(
        `INSERT OR REPLACE INTO cardmarket_products
           (id_product, name, id_expansion, date_added, match_name, search_text)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const product of products) {
        insert.run(
          product.idProduct,
          product.name,
          product.idExpansion,
          product.dateAdded,
          cardmarketMatchName(product.name),
          cardmarketSearchText(product.name)
        );
      }
      this.saveCardmarketProductsState(state);
    })();
  }

  /** The product list download stored last (`catalog_meta` key `cardmarket_products`), if any. */
  getCardmarketProductsState(): CardmarketProductsState | undefined {
    const row = this.db
      .prepare("SELECT value FROM catalog_meta WHERE key = 'cardmarket_products'")
      .get() as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as CardmarketProductsState) : undefined;
  }

  saveCardmarketProductsState(state: CardmarketProductsState): void {
    this.db
      .prepare(
        `INSERT INTO catalog_meta (key, value) VALUES ('cardmarket_products', ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`
      )
      .run(stableStringify(state));
  }

  getCardmarketProduct(idProduct: number): CardmarketProduct | undefined {
    const row = this.db
      .prepare(
        `SELECT id_product, name, id_expansion, date_added FROM cardmarket_products
         WHERE id_product = ?`
      )
      .get(idProduct) as CardmarketProductRow | undefined;
    return row ? toCardmarketProduct(row) : undefined;
  }

  /**
   * The Cardmarket expansions the products of a set's cards (as TCGdex
   * reports them) belong to, the most used first.
   */
  listSetExpansions(region: CatalogRegion, setId: string): number[] {
    return (
      this.db
        .prepare(
          `SELECT p.id_expansion FROM catalog_cards c
           JOIN catalog_cardmarket_products m ON m.region = c.region AND m.card_id = c.id
           JOIN cardmarket_products p ON p.id_product = m.id_product
           WHERE c.region = ? AND c.set_id = ?
           GROUP BY p.id_expansion ORDER BY COUNT(*) DESC, p.id_expansion`
        )
        .all(region, setId) as { id_expansion: number }[]
    ).map((row) => row.id_expansion);
  }

  /**
   * Stored Cardmarket products matching every filter given, those in
   * `prefer`'s expansions first (`inSet`), then by product ID (Cardmarket
   * adds a set's cards roughly in collector number order).
   */
  findCardmarketProducts(
    filter: CardmarketProductFilter,
    limit: number
  ): (CardmarketProduct & { inSet: boolean })[] {
    const where: string[] = [];
    const params: (string | number)[] = [JSON.stringify(filter.prefer ?? [])];
    if (filter.matchNames) {
      where.push('match_name IN (SELECT value FROM json_each(?))');
      params.push(JSON.stringify(filter.matchNames));
    }
    if (filter.contains !== undefined) {
      where.push('instr(search_text, ?) > 0');
      params.push(filter.contains);
    }
    if (filter.expansions) {
      where.push('id_expansion IN (SELECT value FROM json_each(?))');
      params.push(JSON.stringify(filter.expansions));
    }
    params.push(limit);
    const rows = this.db
      .prepare(
        `SELECT id_product, name, id_expansion, date_added,
           id_expansion IN (SELECT value FROM json_each(?)) AS in_set
         FROM cardmarket_products
         ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY in_set DESC, id_product LIMIT ?`
      )
      .all(...params) as (CardmarketProductRow & { in_set: number })[];
    return rows.map((row) => ({ ...toCardmarketProduct(row), inSet: row.in_set === 1 }));
  }

  /** Replaces the stored price guide entries (by product ID) in one transaction. */
  replacePriceGuideEntries(entries: ReadonlyMap<number, object>): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM cardmarket_price_guide').run();
      const insert = this.db.prepare(
        'INSERT INTO cardmarket_price_guide (id_product, entry) VALUES (?, ?)'
      );
      for (const [idProduct, entry] of entries) {
        insert.run(idProduct, JSON.stringify(entry));
      }
    })();
  }

  /** Stored price guide entries of these products, by product ID (those it has). */
  getPriceGuideEntries(idProducts: readonly number[]): Map<number, unknown> {
    const rows = this.db
      .prepare(
        `SELECT id_product, entry FROM cardmarket_price_guide
         WHERE id_product IN (SELECT value FROM json_each(?))`
      )
      .all(JSON.stringify(idProducts)) as { id_product: number; entry: string }[];
    return new Map(rows.map((row) => [row.id_product, JSON.parse(row.entry) as unknown]));
  }

  /** The Cardmarket price guide last applied (`catalog_meta` key `price_guide`), if any. */
  getPriceGuideState(): PriceGuideState | undefined {
    const row = this.db
      .prepare("SELECT value FROM catalog_meta WHERE key = 'price_guide'")
      .get() as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as PriceGuideState) : undefined;
  }

  savePriceGuideState(state: PriceGuideState): void {
    this.db
      .prepare(
        `INSERT INTO catalog_meta (key, value) VALUES ('price_guide', ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`
      )
      .run(stableStringify(state));
  }

  /** Removes prices of cards the catalog no longer has. Returns how many. */
  pruneOrphanPrices(region: CatalogRegion): number {
    return this.db.transaction(() => {
      const { changes } = this.db
        .prepare(
          `DELETE FROM catalog_prices WHERE region = ? AND NOT EXISTS (
             SELECT 1 FROM catalog_cards c WHERE c.region = catalog_prices.region AND c.id = catalog_prices.card_id
           )`
        )
        .run(region);
      if (changes > 0) {
        this.bumpPricesVersion(region);
      }
      return changes;
    })();
  }

  /** A region's prices as clients download them. */
  getPricePack(region: CatalogRegion): CatalogPricePack {
    // One read transaction, so the version always matches the prices returned.
    return this.db.transaction(() => {
      const rows = this.db
        .prepare('SELECT card_id, payload FROM catalog_prices WHERE region = ? ORDER BY card_id')
        .all(region) as { card_id: string; payload: string }[];
      const prices: Record<string, CatalogCardPrices> = {};
      for (const row of rows) {
        const wire = toWirePrices(JSON.parse(row.payload) as StoredCardPrices);
        // Stored figures clients aren't sent (only `low`, say) don't make a card priced.
        if (wire.base || wire.reverseHolo) {
          prices[row.card_id] = wire;
        }
      }
      return { region, version: this.pricesVersion(region), currency: 'EUR' as const, prices };
    })();
  }

  startPriceRun(now = new Date()): number {
    const { lastInsertRowid } = this.db
      .prepare("INSERT INTO catalog_price_runs (started_at, status) VALUES (?, 'running')")
      .run(now.toISOString());
    return Number(lastInsertRowid);
  }

  finishPriceRun(id: number, status: CatalogRunStatus, stats: object, now = new Date()): void {
    this.db
      .prepare('UPDATE catalog_price_runs SET status = ?, stats = ?, finished_at = ? WHERE id = ?')
      .run(status, JSON.stringify(stats), now.toISOString(), id);
  }

  /** Most recent price passes first (diagnostics). */
  listPriceRuns(limit = 20): { id: number; status: string; startedAt: string }[] {
    return this.db
      .prepare(
        'SELECT id, status, started_at AS startedAt FROM catalog_price_runs ORDER BY id DESC LIMIT ?'
      )
      .all(limit) as { id: number; status: string; startedAt: string }[];
  }

  /**
   * When the last completed price pass started. A `partial` one counts, as
   * for full refreshes: the sets it missed keep their previous prices.
   */
  lastCompletedPriceRun(): Date | null {
    const row = this.db
      .prepare(
        "SELECT MAX(started_at) AS at FROM catalog_price_runs WHERE status IN ('ok', 'partial')"
      )
      .get() as { at: string | null };
    return row.at ? new Date(row.at) : null;
  }

  private bumpPricesVersion(region: CatalogRegion): void {
    this.db
      .prepare(
        `INSERT INTO catalog_meta (key, value) VALUES (?, '1')
         ON CONFLICT (key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`
      )
      .run(`prices_version:${region}`);
  }

  private bumpVersion(): void {
    this.db
      .prepare(
        "UPDATE catalog_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'version'"
      )
      .run();
  }
}
