import { createHash } from 'node:crypto';
import type { CatalogCard, CatalogRegion, CatalogSeries, CatalogSet } from '@pokepaper/shared';
import type { Db } from '../db.js';

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

/** Persistence for the imported catalogue (`catalog.db`). */
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

  /**
   * Replaces a set and all of its cards atomically. Cards not in `cards` are
   * removed. Returns false (writing nothing) when the content is unchanged.
   */
  writeSet(set: CatalogSet, cards: readonly CatalogCard[], now = new Date()): boolean {
    const hash = setContentHash(set, cards);
    const stored = this.db
      .prepare('SELECT content_hash FROM catalog_sets WHERE region = ? AND id = ?')
      .get(set.region, set.id) as { content_hash: string } | undefined;
    if (stored?.content_hash === hash) {
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

  /** Runs left `running` by a process that died mid-import. */
  abandonRunningRuns(now = new Date()): void {
    this.db
      .prepare(
        "UPDATE catalog_runs SET status = 'aborted', finished_at = ? WHERE status = 'running'"
      )
      .run(now.toISOString());
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

  private bumpVersion(): void {
    this.db
      .prepare(
        "UPDATE catalog_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'version'"
      )
      .run();
  }
}
