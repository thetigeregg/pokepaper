# Card catalog

PokePaper's card data comes from [TCGdex](https://tcgdex.dev), a community-maintained, open-source Pokémon TCG database. The server imports it into its own SQLite file on a schedule. Clients will download it from the server (never from TCGdex directly), so the app keeps working if TCGdex is slow, down, or changes its API.

Status: the server import, download API and image cache (`server/src/catalog/`) and the app's offline copy (`CatalogSyncService`) are implemented. Image caching on the device and the browsing screens come next.

## Data model

TCGdex splits cards into two **regions**, each with its own card IDs:

| Region | Languages imported                                                    | IDs                                                                                             |
| ------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `intl` | English, French, Italian, German                                      | One ID per printing across these languages: `sv01-001` is Pineco, Pomdepik and Tannza           |
| `asia` | Japanese, Traditional Chinese (`zh-tw`), Simplified Chinese (`zh-cn`) | Shared within the region: `SV2a-001` is フシギダネ and 妙蛙種子. `zh-cn` is mostly its own sets |

IDs can repeat across regions (`neo1` exists in both) and are case-sensitive (`CSM1aC` and `csm1a` are different sets), so a card is identified by **region + ID**. There's no link between an English printing and its Japanese one; translations are shown within a region.

Each card is stored **once, with every language's text**: name, flavor text, rules text, attack and ability names and effects, and that language's scan. The rest (category, rarity, types, stage, HP, Pokédex numbers, weaknesses, attack costs and damage, legality, …) is language-neutral and uses **English vocabulary** everywhere, so filters work the same in every language. TCGdex localizes that vocabulary for French, Italian and German (`Plante` for `Grass`), so the import takes it from the English printing. For the few cards TCGdex has only in another language (some French promo sets), it uses a translation table learned from cards that exist in both.

Payload shapes are the shared `CatalogSeries`, `CatalogSet` and `CatalogCard` types (`shared/src/catalog.ts`). Images are stored as paths on TCGdex's asset host (`fr/sv/sv01/001`), not fetched by the import.

### What TCGdex has (measured November 2026)

| Language            | Sets with cards | Cards  | With a scan in this language  |
| ------------------- | --------------- | ------ | ----------------------------- |
| English             | 217             | 23,912 | 93%                           |
| French              | 198             | 22,333 | 84%                           |
| Italian             | 115             | 15,867 | 93%                           |
| German              | 149             | 20,534 | 76% (almost none before 2010) |
| Japanese            | 121             | 13,156 | 57% (30% linked by TCGdex)    |
| Traditional Chinese | 83              | 7,436  | 30%                           |
| Simplified Chinese  | 8               | 877    | none                          |

In all, 24,005 international and 16,611 Asian cards. TCGdex's own set totals claim more (e.g. 21.5k Italian, 19.3k Japanese cards), but many sets are listed with a name and no cards (79 Italian, 83 Japanese, 49 of 57 Simplified Chinese). The import stores every card TCGdex actually lists.

**Scans.** Coverage includes scans the import found unlinked (see [Unlinked scans](#unlinked-scans)), which raised Japanese from 30% to 57%. Only 6% of international cards have no scan in any of the four languages, so a missing German or French scan can usually be replaced by another language's. 51% of Asian cards have none in any Asian language.

Sets TCGdex lists without any cards are skipped, and they appear automatically if TCGdex fills them in later.

## Import

The server runs an import **10 seconds after startup**, then **every `CATALOG_REFRESH_HOURS`** (default 24) after the previous one finished, so runs never overlap.

- **Light pass** (usual): fetches the series and set listings and every set's card list (about 1,150 requests for all seven languages), then full details only for cards, or card languages, not stored yet. Sets and cards TCGdex no longer lists are removed.
- **Full refresh**: also refetches every card (about 105,000 requests), picking up TCGdex's corrections. It runs when the last full refresh is older than `CATALOG_FULL_REFRESH_DAYS` (default 7), and on the very first start, when it builds the catalog. It takes 10–15 minutes.

The client is polite to the free API: 4 requests at a time, a 20-second timeout, a 5 MB cap on each response, retries with backoff on network errors, 429 and 5xx (honoring `Retry-After`), and a `User-Agent` naming the project. Shutdown cancels requests and retry waits immediately.

**Failures stay contained.**

- **Cards:** a card TCGdex can't serve (404 or malformed) is skipped.
- **Sets:** a set keeps its previous data, and the run ends `partial`, when its requests keep failing or when any language listing the set returns a missing or unusable set detail. A set is rewritten only from complete data, and removed only when TCGdex's listings no longer include it. The first unavailable error in a set cancels its remaining requests.
- **Outages:** after 3 failed sets in a row, the rest of that region is skipped for this run (`catalog.region_interrupted`), keeping its data, rather than retrying every set against an API that's down.
- **Listings:** if a language's listings can't be loaded, that whole region is left untouched, because missing sets would otherwise look like removals.

Only a database error or shutdown ends a run early. Every run is recorded in `catalog_runs` with its stats, and logged as `catalog.ingest_started`, `catalog.ingest_progress` and `catalog.ingest_finished`.

Each set is written in one transaction together with a **content hash** (SHA-256 of the set and its cards as canonical JSON), and a catalog **version** is bumped whenever anything changes. Clients compare these to download only the sets that changed.

### Unlinked scans

For each card language without a linked scan, the import checks, with one HEAD request to TCGdex's image server, the path the scan would have:

- the card's linked path in another language, with the language swapped in (`en/sv/sv01/172` → `fr/sv/sv01/172`);
- otherwise `{language}/{serie}/{set}/{number}`.

A path counts only when both sizes (`low.webp` and `high.webp`) exist. A hit becomes the card's image, so downloaded data always says exactly which languages have a scan. Answers are kept in `catalog_image_probes`: hits for good, misses for 30 days. Paths are validated like every other image path before they're checked.

Checks are best effort. The first one that fails cancels the set's remaining checks, which are retried next run (the run ends `partial`, logged as `catalog.image_checks_failed`). After 3 sets in a row with failed checks, checking pauses for the rest of the run (`catalog.image_checks_paused`), so an outage of TCGdex's image server can't stall the import. Remembered hits always apply. The first run with this feature made 25,705 checks in about 15 minutes and found 4,505 scans; later runs only check new cards and expired misses.

### Running it by hand

```bash
npm run catalog:sync --workspace server             # light pass
npm run catalog:sync --workspace server -- --full   # full refresh
```

It uses the server's configuration (`DATA_DIR`, `CATALOG_LANGUAGES`, …) and can run while the server is up. Locally, `CATALOG_LANGUAGES=zh-tw npm run catalog:sync --workspace server` builds a small catalog in seconds.

## Download API

All routes need a session, like the rest of the API. Wire types are in `shared/src/catalog.ts`.

| Route                                                     | Response                                                                                                                   |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/catalog/manifest`                               | `CatalogManifest`: catalog version, languages, every series, and each set's `hash` and card count. `ETag` from the version |
| `GET /api/catalog/sets/:region/:setId`                    | `CatalogSetPack`: the set and all its cards in display order. `ETag` = the set's hash                                      |
| `GET /images/catalog/cards/:region/:cardId/:lang/:q.webp` | Card scan, `q` = `low` (grids, ~18 KB) or `high` (detail, ~75 KB). Use `catalogCardImageUrl()`                             |
| `GET /images/catalog/sets/:region/:setId/logo/:lang.webp` | Set logo in a language                                                                                                     |
| `GET /images/catalog/sets/:region/:setId/symbol.webp`     | Set symbol                                                                                                                 |

- **Revalidation:** the manifest and packs are sent with `Cache-Control: private, no-cache` and an `ETag`. Sending it back in `If-None-Match` gets an empty `304` when nothing changed. The tag is checked before anything is loaded, so checking for updates costs almost nothing. Matching is weak, as RFC 9110 specifies: it ignores a `W/` prefix (Cloudflare weakens tags it recompresses) and a `-gzip`/`-zstd`/`-br` suffix (added by the edge's compression). Both are read in one transaction, so a pack's hash always matches its cards, even mid-import.
- **Images** are served only when the catalog links them: the server looks up the card or set, so the routes can't be used to fetch arbitrary TCGdex files. Unknown cards, languages without a scan and unsupported names get `404` without contacting TCGdex. An image is fetched from TCGdex the first time it's requested, checked to be WebP by its file signature (TCGdex labels some as `application/octet-stream`), capped at 2 MB, and stored in `DATA_DIR/images/catalog/` under a hash of its path. Concurrent requests for one image share one fetch, and at most 6 fetches run at once, so an offline set download doesn't flood TCGdex. Temporary errors (network, 429, 5xx) are retried twice. If TCGdex still fails, the response is `502` and nothing is cached. Responses carry `Cache-Control: private, max-age=604800`.
- **Rate limit:** image routes allow 3,000 requests per minute per client, above the global 600, because a set grid or an offline download loads hundreds at once (the app caches every image it gets).

## On the device

The app keeps a **full copy of the catalog** in its local storage: IndexedDB on the web, SQLite in the iOS app, through the same `StorageEngine` as user data, with both engines held to the shared contract tests. Every series, set and card is stored, in all imported languages, so browsing works offline. Chrome stores the whole catalog in about 35–50 MB.

`CatalogSyncService` (`src/app/core/services/catalog-sync.service.ts`) keeps it current:

- **When:** on app start, every 6 hours, when the browser comes back online, and from Settings → Card catalog → "Check for updates". Never while signed out: it follows `SyncService`'s sign-in state.
- **How:**
  - Fetch the manifest, sending the last ETag; an unchanged catalog costs one empty `304`.
  - Download each set whose hash differs from the stored copy, 3 at a time. Each set is stored atomically, replacing its earlier copy.
  - Remove sets the server dropped.
  - Rate limiting and temporary failures (`429`, `5xx`, a dropped connection) are retried up to 3 times per set, honouring `Retry-After`.
- **Resuming:** the manifest's ETag is saved only after every set has landed, so an interrupted download resumes with just the missing sets.
- **Browser storage:** after the first download, the app asks the browser to keep its storage (`navigator.storage.persist()`) so the catalog isn't evicted. If it is (Safari can evict sites that aren't on the home screen), it re-downloads.

The first download is about 390 requests (one per set) and roughly 10–12 MB over the network.

## Storage

The catalog lives in **`catalog.db`**, next to `pokepaper.db` in `DATA_DIR`, with its own migrations in `server/src/catalog/migrations/`. It holds no user data and can be rebuilt from TCGdex, so it's **not included in the server's backups** (it would add about 90 MB to each). To rebuild it from scratch, stop the server, delete `catalog.db` (and any `catalog.db-wal` / `catalog.db-shm`), and start it again: the first run is a full refresh.

Cached images live in `DATA_DIR/images/catalog/` and are also rebuildable (delete the folder any time). The folder only grows with images someone actually viewed or downloaded: about 18 KB per grid image and 75 KB per detail image. Every grid image in all seven languages would be about 2 GB.

## Configuration

| Variable                    | Default                      | Purpose                                                                |
| --------------------------- | ---------------------------- | ---------------------------------------------------------------------- |
| `CATALOG_SYNC_ENABLED`      | `true`                       | Run the scheduled import                                               |
| `CATALOG_LANGUAGES`         | `en,fr,it,de,ja,zh-tw,zh-cn` | Languages to import (comma-separated TCGdex codes)                     |
| `CATALOG_REFRESH_HOURS`     | `24`                         | Hours between imports (1–168)                                          |
| `CATALOG_FULL_REFRESH_DAYS` | `7`                          | A run is a full refresh when the last one is at least this old (1–365) |

## Attribution

Card data: [TCGdex](https://github.com/tcgdex/cards-database) (MIT License). Card images and names are © The Pokémon Company, Nintendo, Game Freak and Creatures. PokePaper is a personal, non-commercial project not affiliated with them.
