# Card catalogue

PokePaper's card data comes from [TCGdex](https://tcgdex.dev), a community-maintained, open-source Pokémon TCG database. The server imports it into its own SQLite file on a schedule. Clients will download it from the server (never from TCGdex directly), so the app keeps working if TCGdex is slow, down, or changes its API.

Status: the server import is implemented (`server/src/catalog/`). The download API, image cache and app screens come next.

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
| French              | 198             | 22,333 | 83%                           |
| Italian             | 115             | 15,867 | 93%                           |
| German              | 149             | 20,534 | 74% (almost none before 2010) |
| Japanese            | 121             | 13,156 | 30% (none before 2020)        |
| Traditional Chinese | 83              | 7,436  | 29%                           |
| Simplified Chinese  | 8               | 877    | none                          |

In all, 24,005 international and 16,611 Asian cards. TCGdex's own set totals claim more (e.g. 21.5k Italian, 19.3k Japanese cards), but many sets are listed with a name and no cards (79 Italian, 83 Japanese, 49 of 57 Simplified Chinese). The import stores every card TCGdex actually lists.

**Scans.** Only 6% of international cards have no scan in any of the four languages, so a missing German or French scan can usually be replaced by another language's. 71% of Asian cards have none in any Asian language. Some scans exist on TCGdex's image server without being linked from the card data (about 38% of the missing Japanese ones), so the image route will also try a card's expected path.

Sets TCGdex lists without any cards are skipped, and they appear automatically if TCGdex fills them in later.

## Import

The server runs an import **10 seconds after startup**, then **every `CATALOG_REFRESH_HOURS`** (default 24) after the previous one finished, so runs never overlap.

- **Light pass** (usual): fetches the series and set listings and every set's card list (about 1,150 requests for all seven languages), then full details only for cards, or card languages, not stored yet. Sets and cards TCGdex no longer lists are removed.
- **Full refresh**: also refetches every card (about 105,000 requests), picking up TCGdex's corrections. It runs when the last full refresh is older than `CATALOG_FULL_REFRESH_DAYS` (default 7), and on the very first start, when it builds the catalogue. It takes 10–15 minutes.

The client is polite to the free API: 4 requests at a time, a 20-second timeout, retries with backoff on network errors, 429 and 5xx (honoring `Retry-After`), and a `User-Agent` naming the project.

**Failures stay contained.** A card TCGdex can't serve (404 or malformed) is skipped. A set whose requests keep failing keeps its previous data, and the run ends `partial`. If a language's listings can't be loaded, that whole region is left untouched, because missing sets would otherwise look like removals. Only a database error or shutdown ends a run early. Every run is recorded in `catalog_runs` with its stats, and logged as `catalog.ingest_started`, `catalog.ingest_progress` and `catalog.ingest_finished`.

Each set is written in one transaction together with a **content hash** (SHA-256 of the set and its cards as canonical JSON), and a catalogue **version** is bumped whenever anything changes. Clients will compare these to download only the sets that changed.

### Running it by hand

```bash
npm run catalog:sync --workspace server             # light pass
npm run catalog:sync --workspace server -- --full   # full refresh
```

It uses the server's configuration (`DATA_DIR`, `CATALOG_LANGUAGES`, …) and can run while the server is up. Locally, `CATALOG_LANGUAGES=zh-tw npm run catalog:sync --workspace server` builds a small catalogue in seconds.

## Storage

The catalogue lives in **`catalog.db`**, next to `pokepaper.db` in `DATA_DIR`, with its own migrations in `server/src/catalog/migrations/`. It holds no user data and can be rebuilt from TCGdex, so it's **not included in the server's backups** (it would add about 90 MB to each). To rebuild it from scratch, stop the server, delete `catalog.db` (and any `catalog.db-wal` / `catalog.db-shm`), and start it again: the first run is a full refresh.

## Configuration

| Variable                    | Default                      | Purpose                                                        |
| --------------------------- | ---------------------------- | -------------------------------------------------------------- |
| `CATALOG_SYNC_ENABLED`      | `true`                       | Run the scheduled import                                       |
| `CATALOG_LANGUAGES`         | `en,fr,it,de,ja,zh-tw,zh-cn` | Languages to import (comma-separated TCGdex codes)             |
| `CATALOG_REFRESH_HOURS`     | `24`                         | Hours between imports                                          |
| `CATALOG_FULL_REFRESH_DAYS` | `7`                          | A run is a full refresh when the last one is at least this old |

## Attribution

Card data: [TCGdex](https://github.com/tcgdex/cards-database) (MIT License). Card images and names are © The Pokémon Company, Nintendo, Game Freak and Creatures. PokePaper is a personal, non-commercial project not affiliated with them.
