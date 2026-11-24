# Card catalog

PokePaper's card data comes from [TCGdex](https://tcgdex.dev), a community-maintained, open-source Pokémon TCG database. The server imports it into its own SQLite file on a schedule. Clients will download it from the server (never from TCGdex directly), so the app keeps working if TCGdex is slow, down, or changes its API.

Status: the server import, download API, image cache and Cardmarket prices (`server/src/catalog/`), the app's offline copy (`CatalogSyncService`) and the app's image cache (`ImageCacheService`, `ImageDownloadService`) are implemented. The browsing and search screens are implemented too (see [Browsing](#browsing) and [Search](#search)).

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

### Misattributed printings

Sharing IDs across a region's languages assumes a card number means the same card in each. Japan and Taiwan number their Scarlet & Violet promos (`SV-P`) independently, though, and TCGdex filed the Taiwanese names and texts on the Japanese cards: Traditional Chinese SV-P-098 is named Latias (拉帝亞斯) but carries Detective Pikachu's HP, Pokédex number and illustrator. All 81 SV-P cards TCGdex has in both languages were affected (measured November 2026). Every other Asian set, including the promo sets S10P and SV2P, passed a check of each card's Japanese and Chinese names against the rest of the catalog.

`MISATTRIBUTED_PRINTINGS` (`server/src/catalog/normalize.ts`) lists such set languages. The import neither fetches nor keeps their printings of cards that other languages have, so those cards are Japanese only. Cards only that language has (13 in SV-P: Motoliz, basic Energy, Trainers) are kept, and so is the set's name in it. Stored text from before the rule is dropped on the next pass. Since TCGdex gives both printings the same language-neutral data, the import can't detect this case by itself.

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

### Basic Energy scans

TCGdex has no scan for many basic Energy printings: all 16 cards of Mega Evolution Energy, and about half of the 344 international basic Energy printings in November 2026. Basic Energy art barely changes between printings, so after each region's sets are imported (`borrowEnergyScans`, `energy-scans.ts`):

- **Borrowed:** each basic Energy language without a scan of its own gets a scan of the same Energy type in that language from a regular printing: Common (or no rarity) first, then Uncommon, never the gold and full-art ones (Hyper rare, Secret Rare, …) whose art doesn't stand in for a regular card; then the newest set, then the card ID. `imageFrom` names the printing it came from. In November 2026 that fills 350 card languages, mostly from Sun & Moon and Evolutions printings. A language with no such scan anywhere gets none; the app then shows another language's scan, as for any card.
- **Basic Energy is recognized by both its `energyType` ("Normal") and its English name** ("Fire Energy", "Basic Fire Energy"; `basicEnergyTypeOf` in `shared/`). Each alone is wrong somewhere: TCGdex marks some special Energy (Prism Energy, Ignition Energy) as basic, and older special Energy (Neo to HeartGold & SoulSilver) are named plain "Darkness Energy" and "Metal Energy". Many basic Energy have no types, so the name gives the type. Japan & Asia printings have no English name, so they don't borrow.
- **Kept current:** a borrowed scan moves to a better source when one appears (a plainer or newer printing), and is dropped if its source disappears. A set rebuilt from fresh TCGdex data (every full run) keeps the borrowed scans it had (`carryBorrowedScans`), so it isn't written without them and downloaded twice, even if the run stops before the end-of-region pass. Sets whose cards change are rewritten, so the app downloads them again.
- **Never in the way of the real scan:** the unlinked-scan check treats a borrowed scan as none (it's never used to build another language's path), so the card's own path is still checked, and a hit replaces the borrowed scan.
- **In the app:** a borrowed scan is badged "Alt" (with its language too when that differs, "EN · Alt"), and the card's Details say "Scan: From another printing". Its image URL ends in `?from=<source>`, so the app's image cache, which is keyed by URL, fetches it anew when the source changes or the card gets its own scan; the server ignores the query, and every other card's URL is unchanged.

## Prices

Card prices come from [Cardmarket](https://www.cardmarket.com), Europe's main marketplace for singles: its daily price guide, in euros (see The price pass). TCGdex relays the same figures in each card's details (`pricing.cardmarket`), and TCGplayer's (US dollars), which aren't imported.

**What a price covers.** One Cardmarket product covers a printing in every language of its region: English, French, Italian and German copies of `sv01-001` share one price, and a Japanese and a Traditional Chinese copy of `SV2a-001` share another (the Japanese product's). Prices aren't per condition either. The guide has two finishes:

| Figures                                 | Finish                                                     |
| --------------------------------------- | ---------------------------------------------------------- |
| Plain (`trend`, `avg30`, …)             | The normal print; for cards printed only as holo, the holo |
| `-holo` (`trend-holo`, `avg30-holo`, …) | The reverse holo                                           |

Each finish has `trend` (Cardmarket's headline price, smoothed over recent sales), `avg` (average sale price), `low` (cheapest listing in any condition or language), and `avg1`, `avg7` and `avg30` (average sale price over the last 1, 7 and 30 days). Cardmarket reports "no data" as 0, which is stored as no figure. In a November 2026 sample, `trend` and `avg30` agreed within 2× on all but 3 of 302 modern international prices, and on all cards worth €5 or more but 4 of 90; they diverge on cheap, rarely sold cards (Japanese and vintage commons), where `trend` often drops to €0.02.

**Coverage** (sampled November 2026, from TCGdex's product IDs): 87% of international cards (the gaps are TCG Pocket's digital sets, some promos and Gym), 92% of Japanese cards from 2011 on, but no Japanese cards from before 2011, and 42% of Traditional Chinese cards.

**The price pass.** Cardmarket publishes its whole price guide as one download ([`price_guide_6.json`](https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json), Pokémon: about 81,000 products, 16 MB, regenerated each night around 02:45 CET), the same figures TCGdex relays, keyed by Cardmarket product. TCGdex has each card's product in its card details (`pricing.cardmarket.idProduct`), so:

- **The import records products.** Whenever it fetches a card's details, it stores the card's product (`catalog_cardmarket_products`; one product covers every language of a region), in the same transaction as the set. Only a full refresh, which fetches every language, forgets a product TCGdex no longer reports, and the card's prices with it; a light run fetches only new languages, which may lack it. New cards get theirs when their set arrives, and the weekly full refresh refetches them all. Migration `0005` started the table from the IDs the earlier TCGdex price pass had stored.
- **Recent cards are looked up.** TCGdex adds Cardmarket data some days after a release, and light runs don't refetch stored cards, so each pass first looks up, on TCGdex, cards without a product from sets released in the last 60 days (`PRODUCT_LOOKUP_DAYS`): a few hundred requests at most. One TCGdex can't serve is skipped (`catalog.product_lookups_failed`) and looked up again next pass. Older cards without one wait for the weekly refresh.
- **The pass downloads the guide once** and prices every card by its product (a November 2026 check: every priced card's product was in the guide, with identical figures to TCGdex's). It sends the guide's last ETag, so an unchanged guide costs an empty `304` (`unchanged`, which counts as done), unless products changed since that guide was applied (the products version), which applies it anew. The download is capped at 128 MB while it's read. It takes about a second, instead of the roughly 41,000 TCGdex requests (5 minutes) of fetching every card's details.
- It runs after the scheduled import when the last completed pass started at least `CATALOG_PRICES_REFRESH_HOURS` ago (default 24), or when no guide is stored (as after catalog migration `0006`: until a pass stores one, matches made by hand can't be priced), so with the default schedule, once a day; since it follows an import, it never runs more often than `CATALOG_REFRESH_HOURS`. It runs even if the import failed, over whatever the catalog holds.
- **Failures change nothing:** a guide that can't be downloaded or isn't one (`catalog.price_guide_failed`), or that lacks more than half the products the catalog's cards map to (`catalog.price_guide_incomplete`, a truncated download rather than a market that vanished overnight), leaves every price as it was. The pass ends `failed` and doesn't count as done, so the next scheduled run tries again.
- Each region's prices are written in one transaction. A card whose product has no figures, or isn't in the guide, loses its prices. One without a product is left as it was. Prices and products of cards that left the catalog are pruned.
- A card's `updated` time is when Cardmarket generated the guide.
- **Cardmarket links.** TCGdex reports each card's Cardmarket product ID, which is stored and sent with its prices (`idProduct`, absent when unknown). `https://www.cardmarket.com/en/Pokemon/Products?idProduct=<id>` opens the card's page on Cardmarket (`cardmarketProductUrl`); `…/Products/Singles?idProduct=` does not. The page takes offer filters: `&language=<id>` (Cardmarket's language IDs, `CARDMARKET_LANGUAGE_IDS`: English 1, French 2, German 3, Italian 5, Simplified Chinese 6, Japanese 7, Traditional Chinese 11) and `&isReverseHolo=Y`, together or apart. Catalog migration `0004` bumps every region's prices version once, so devices holding an older pack download it again with the IDs.
- Prices live in their own table (`catalog_prices`), never in the cards, so they never change a set's hash: daily price changes don't make clients download sets again. Each region has a **prices version**, bumped whenever any of its prices change.
- Every pass is recorded in `catalog_price_runs` and logged as `catalog.prices_started` and `catalog.prices_finished`.
- **The guide is kept** (`cardmarket_price_guide`, one entry per product, replaced whole by each pass that applies a new guide, in one transaction with its state, so the entries always carry its date), so the matcher can show any product's prices and price a card as soon as it's matched (see [Matching by hand](#matching-by-hand)). Catalog migration `0006` forgot the guide last applied, so the next scheduled run refreshes prices whatever the last pass's age, downloading the guide whole instead of getting `304`.

### Matching by hand

TCGdex has no Cardmarket product for some cards, so they get no price. Most English Mega Evolution cards are like this: in November 2026, 80 of the 89 "M … EX" cards (every XY set except Ancient Origins, Generations, Double Crisis and the XY promos), while the regular cards next to them are mapped. Cardmarket spells them without the space ("MMewtwo EX"). Card detail lets you match such a card to a product yourself (docs/ui.md → Card detail). Nothing is matched automatically: guesses would show confidently wrong prices.

- **Cardmarket's product list.** Cardmarket publishes its single cards as a download next to the price guide ([`products_singles_6.json`](https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json), about 76,000 products, 14 MB): `idProduct`, `name` with the attacks that tell printings apart in brackets (`MMewtwo EX [Vanishing Strike]`), `idExpansion`, and `dateAdded`. It has no collector numbers. The server downloads it the first time the matcher needs it, into `cardmarket_products` (`catalog.db`); several requests at once share one download, and if it fails with none stored, the matcher answers `502`. Once the stored list is a day old, a matcher request checks for a newer one (with its ETag) in the background and is answered from the stored list, so the matcher never waits on Cardmarket. A failed check keeps the stored list (`catalog.cardmarket_products_failed`) and isn't retried for an hour. Parsing and storing the list (about a second, at most daily) runs on the server's event loop; `catalog.cardmarket_products_stored` logs how long it took.
- **Candidates** (`CardmarketMatcher.candidates`). Names are compared by their letters and digits only (`cardmarketSearchText`), so "M Mewtwo EX" equals "MMewtwo EX". A card's set is placed in Cardmarket's expansions by the products TCGdex reports for its other cards. Without a search, the matcher offers products with the card's name (in any of its languages) in those expansions. Of those, it keeps the ones sharing an attack or ability with the card, when any do: that's how Cardmarket tells apart BREAKthrough's two M Mewtwo EX. If there are none, it offers that name in any expansion, then the whole expansion (Japanese names never match Cardmarket's English ones). A search matches anywhere in product names, with the set's expansions first; one with fewer than two letters or digits gets the suggestions instead, and `searched` says which the answer holds. Results come in product ID order, which roughly follows collector numbers within an expansion, with the date each product was added and its prices from the kept guide. At most 50 are offered (`truncated` beyond).
- **Telling printings apart.** One expansion can hold several products with the same name: the regular card and its full art, and often a third added years later (many XY EX and GX cards gained one in September 2018). The product's Cardmarket page shows its scan and number, so the matcher links each candidate there.
- **Matches** are stored in `cardmarket_matches` in `pokepaper.db`, not `catalog.db`: the catalog can be rebuilt from TCGdex and isn't backed up, but these can't be. A match wins over TCGdex's product, now and if TCGdex reports one later. Matching or clearing a card prices it at once from the kept guide, by its match, else TCGdex's product; a card with neither loses its prices. Devices get the change with their next price download. Each change also bumps a matches version (`server_meta`), so the next pass applies the guide anew, as when products change. Before any guide is kept, a match waits for the next pass.
- Prices from a match carry `matchedByHand: true`, in the price pack too, so card detail can say where the product came from.
- A full refresh that forgets a card's TCGdex product removes its prices, except for cards matched by hand, which keep theirs (the import and the CLI read the matches too).

### Running it by hand

```bash
npm run catalog:sync --workspace server               # light pass
npm run catalog:sync --workspace server -- --full     # full refresh
npm run catalog:sync --workspace server -- --prices   # price pass
npm run catalog:sync --workspace server -- --rates    # exchange rates
```

It uses the server's configuration (`DATA_DIR`, `CATALOG_LANGUAGES`, …), and the server's database for matches made by hand, and can run while the server is up. Locally, `CATALOG_LANGUAGES=zh-tw npm run catalog:sync --workspace server` builds a small catalog in seconds.

### Currencies

Prices are in euros; the app can show them in another currency (Settings → Collection value → Currency, synced as `UserSettings.currency`), converted at the European Central Bank's [euro reference rates](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html): about 30 currencies, published each working day around 16:00 CET, free and without a key.

- **Server:** each scheduled run starts by fetching the ECB's daily XML (`refreshExchangeRates`, one small request), before the import, so a new server has rates long before its first full import finishes. They're stored in `catalog_meta` (`exchange_rates`) when they're for a new day. On any failure (unreachable, an error, not rates) the stored rates stay, logged as `catalog.rates_failed`. The app never contacts the ECB itself.
- **Lag:** runs come every `CATALOG_REFRESH_HOURS` (default 24) after the previous one ends, so the rates in use can be a day behind the ECB's latest (a run before 16:00 CET gets the previous working day's). For showing card prices, that's close enough.
- **App:** each catalog run, after the prices and only once sets are on the device, downloads them (`GET /api/catalog/rates`, with the stored ETag) into sync metadata (`exchangeRates`, with `exchangeRatesEtag`, in one transaction). They're fetched even when prices fail, and a rates failure is only logged (`catalog.rates_sync_failed`): it doesn't fail the catalog run. `CurrencyService` converts and formats every amount (`format`), in the picked currency when it has a rate, else in euros (as until rates first arrive). Amounts are converted for display only: values are summed in euros first.
- Screens that show a converted amount say so: "converted from euros at the ECB rate of Nov 20, 2026".

## Download API

All routes need a session, like the rest of the API. Wire types are in `shared/src/catalog.ts`.

| Route                                                     | Response                                                                                                                                                                                                    |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/catalog/manifest`                               | `CatalogManifest`: catalog version, languages, every series, and each set's `hash` and card count. `ETag` from the version                                                                                  |
| `GET /api/catalog/sets/:region/:setId`                    | `CatalogSetPack`: the set and all its cards in display order. `ETag` = the set's hash                                                                                                                       |
| `GET /api/catalog/rates`                                  | `ExchangeRates`: the ECB's rates per euro for one day. `ETag` from the day; `404` before the server has fetched any                                                                                         |
| `GET /api/catalog/prices/:region`                         | `CatalogPricePack`: `trend`, `avg7` and `avg30` of each finish, plus Cardmarket's product ID (`idProduct`), for every card in the region with at least one of them. `ETag` from its prices version          |
| `GET /api/catalog/cardmarket/:region/:cardId/candidates`  | `CardmarketCandidates`: the card's current product and products to match it to, searched with `?q=` (at most 100 characters). `404` for an unknown card, `502` while Cardmarket's product list can't be had |
| `PUT /api/catalog/cardmarket/:region/:cardId/match`       | Body `{ idProduct }`: matches the card by hand and prices it (`204`). `400` for a malformed ID, `422` for a product not in Cardmarket's list                                                                |
| `DELETE /api/catalog/cardmarket/:region/:cardId/match`    | Forgets the card's match (`204`, also when it had none)                                                                                                                                                     |
| `GET /images/catalog/cards/:region/:cardId/:lang/:q.webp` | Card scan, `q` = `low` (grids, ~18 KB) or `high` (detail, ~75 KB). Use `catalogCardImageUrl()`                                                                                                              |
| `GET /images/catalog/sets/:region/:setId/logo/:lang.webp` | Set logo in a language                                                                                                                                                                                      |
| `GET /images/catalog/sets/:region/:setId/symbol.webp`     | Set symbol                                                                                                                                                                                                  |

- **Revalidation:** the manifest, set packs and price packs are sent with `Cache-Control: private, no-cache` and an `ETag`. Sending it back in `If-None-Match` gets an empty `304` when nothing changed. The tag is checked before anything is loaded, so checking for updates costs almost nothing. Matching is weak, as RFC 9110 specifies: it ignores a `W/` prefix (Cloudflare weakens tags it recompresses) and a `-gzip`/`-zstd`/`-br` suffix (added by the edge's compression). Both are read in one transaction, so a pack's hash always matches its cards, even mid-import.
- **Images** are served only when the catalog links them: the server looks up the card or set, so the routes can't be used to fetch arbitrary TCGdex files. Unknown cards, languages without a scan and unsupported names get `404` without contacting TCGdex. An image is fetched from TCGdex the first time it's requested, checked to be WebP by its file signature (TCGdex labels some as `application/octet-stream`), capped at 2 MB, and stored in `DATA_DIR/images/catalog/` under a hash of its path. Concurrent requests for one image share one fetch, and at most 6 fetches run at once, so an offline set download doesn't flood TCGdex. Temporary errors (network, 429, 5xx) are retried twice. If TCGdex still fails, the response is `502` and nothing is cached. Responses carry `Cache-Control: private, max-age=604800`.
- **Rate limit:** each catalog route (manifest, packs and images) allows 3,000 requests per minute per client, above the global 600. A device's first download is about 390 pack requests, a set grid or an offline download loads hundreds of images at once, and devices at home share one public IP.

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

### Prices on the device

After the sets, each run downloads the [prices](#prices) of every catalog with sets on the device (`GET /api/catalog/prices/:region`), sending the ETag it stored for that catalog (`catalogPricesEtag:<region>` in sync metadata), so unchanged prices cost one empty `304`. A changed pack replaces the catalog's stored prices whole, in one transaction (`replaceCatalogPrices`, store `catalogPrices`, keyed `region:cardId`), so they always come from a single pass. With the server's daily price pass, that's one download a day per catalog, about 300 KB for the international one.

- Prices come after the sets are confirmed current (the check time is recorded and persistent storage requested first); meanwhile the status is `checking`.
- Prices are retried like set packs. If they still fail, the run ends `error`, but the sets stay current and the prices already on the device stay, so they work offline from the last download. A pack for another catalog than the one asked for is refused the same way.
- The stored ETag is written in the same transaction as the prices, so it always matches them.
- A server without prices (`404`) is skipped quietly; the catalog itself is unaffected.
- When a catalog has no sets left on the device, its prices and ETag are dropped.
- `getCatalogCardPrices(region, cardId)` reads a card's prices; a card Cardmarket doesn't price has none. `CatalogSyncService.pricesChanged$` emits after new prices are stored, and `CatalogPriceService` (which screens read prices through) bumps its `version` signal, so open screens reload them.
- **Shown price:** a finish's headline price is its `trend`, else its `avg30` (`headlinePrice`), since `trend` is what Cardmarket itself headlines. Card detail shows it per finish with the 7- and 30-day averages below (docs/ui.md → Card detail).
- **Reverse holo figures.** Cardmarket reports `-holo` figures for many cards never printed in reverse holo, apparently from sales sellers tagged as one: Base Set Charizard (€124 next to €442, though reverse holos began with Legendary Collection in May 2002), Fates Collide's full art Kingdra-EX (€6.84, with no reverse holo listed), EX Dragon's Kingdra ex (€13). Card detail shows a reverse holo price, and a Reverse holo stepper, only for a card that can come in one (`reverseHoloPossible`, used by `priceRows` and `offeredVariants`):
  - Never in a set released before May 2002, even when TCGdex flags the card as coming in reverse holo: it does for 10 such cards (Jungle's Rhydon and Rhyhorn, Wizards promos 34 Entei and 35 Pichu, six Southern Islands cards in a November 2026 check).
  - Otherwise always when TCGdex flags the card as coming in reverse holo.
  - Never in a set whose flags TCGdex keeps: most of its plain (no suffix) commons and uncommons are flagged (`flagsReverseHolos`, read per set from the cards on the device and cached until a sync changes the sets). This covers Scarlet & Violet, Sword & Shield and most older sets.
  - In the Japan & Asia catalog, only when flagged: few Japanese sets have mirror holos, and TCGdex flags them (S9a, S10a, S11a, SV2a, SV11B, SV11W in a November 2026 check), while its rarities don't mean the same there (Rarity symbols).
  - Otherwise, in the international catalog, always when TCGplayer sells the card in reverse holo (`tcgplayerFinishes`, below), and never when TCGplayer lists the card's finishes but sells no card of its set in reverse holo (POP Series, Dragon Vault, Celebrations: `setReverseHolos`). In a set it sells reverse holos of, a card without a reverse holo entry may just be one TCGplayer lacks (Delta Reign's uncommon 094 in a November 2026 check), so the rule below decides. TCGdex's flags can't decide there: in a November 2026 check, dozens of later sets that have reverse holos had no card flagged (every XY set, most of Sun & Moon, EX Delta Species to Power Keepers, Plasma Storm, Plasma Freeze), and Forbidden Light, Team Up, Unbroken Bonds, Unified Minds and Plasma Blast had one or two commons flagged each.
  - Otherwise only for a card without a suffix (EX, GX, V, ex…) of a rarity printed in reverse holo: Common, Uncommon, Rare, Holo Rare (spelled Rare Holo in some Diamond & Pearl sets). Except Prism Stars (◇ in the name: TCGdex gives them no suffix), cards of subsets printed without reverse holos (numbered RC, TG or GG: Radiant Collection, Trainer and Galarian Galleries), and cards of promo sets (named "… Promo" or "… Promos"; TCGdex calls the older ones Common, like DP Black Star Promos' Garchomp C LV.X).
  - If the set's cards can't be read, the base finish still shows and the reverse holo goes by the card alone (`UNKNOWN_SET_REVERSE_HOLOS`). Card detail reads the set's cards apart from the card's prices, so a failed price read doesn't hide a Reverse holo stepper.
  - The collection steppers offer TCGdex's variants (`cardVariants`, with Normal named Holo when TCGplayer sells the card as a holo and not as a non-holo: TCGdex lists many holo rares as normal; `listedVariants`) plus Reverse holo whenever this says the card can come in one (`offeredVariants`), so the two always agree; a copy already counted under another variant stays there (moving it is up to the user). The server keeps the figures as reported, and a copy owned in reverse holo is still valued at them (`variantFigures`), except in a set released before May 2002, where it's valued at the base finish's.

- **TCGplayer's finishes.** TCGdex's card details also carry TCGplayer's prices, one entry per finish it sells the card in (`normal`, `holofoil`, `reverse-holofoil`, and `unlimited`, `1st-edition`, `1st-edition-holofoil`, `unlimited-holofoil` for WotC-era cards). The import keeps which finishes those are as the card's `tcgplayerFinishes` (`parseTcgplayerFinishes`; an entry counts only with a price, and the field is absent when none does), not the prices. A finish stays once seen (`keptFinishes`): TCGplayer's entries follow its sales and can drop out for a while, and the card, with its set's hash, shouldn't change with them. In a November 2026 sample of sets without reverse holo flags, they matched the real printings: reverse holos in ordinary sets (BREAKthrough's Typhlosion, a holo rare TCGdex lists as normal), none in POP Series, Dragon Vault, Celebrations, the Unown Collection or Detective Pikachu. TCGplayer lists nothing for DP and BW Black Star Promos, the Trainer and Galarian Galleries, Generations' Radiant Collection and some EX-era holo rares, which fall back to the rarity rule above. Being part of the card, they change its set's hash when a finish is first seen; light runs keep the stored ones, so cards gain them at the next full refresh.

## Images on the device

Card scans aren't part of the catalog download (every grid-size scan in all seven languages would be about 2 GB). The app keeps them two ways:

- **Recently viewed:** an image is saved the first time it's shown (by the browsing screens). These are capped at a size you choose in Settings → Images (250 MB, 500 MB by default, 1 GB or 2 GB). Past the cap, the least recently viewed go first.
- **Downloaded sets:** `ImageDownloadService.downloadSet(region, setId, languages)` downloads and **pins** a set's grid-size scans, so they work offline and are never evicted. For each card and language it pins the scan the app would show: that language's, else the region's fallback language's. Images already on the device are just pinned, so running it again resumes. Removing a set unpins its images, which then count as recently viewed. One image pinned by two sets stays until both are removed. The languages a set was downloaded in are recorded (`downloadedSets`), so Settings → Images → Downloaded sets can list downloads grouped by series, with search and removal per set, per series, or all at once.

`ImageCacheService` stores images by their same-origin URL: as blobs in IndexedDB on the web, and as files under the iOS app's cache folder (`ImageFileStore`). The cache folder keeps gigabytes of re-downloadable scans out of iCloud backups; if iOS purges it when storage runs low, an image is simply downloaded again when next shown. Images the server doesn't have (`404`) aren't requested again during the session. On the web, a shown image is an object URL shared by everything showing it; each display holds it through `ImageSlot` and releases it when it shows something else or goes away, and the last release frees the memory. Pins live in their own table (`imagePins`), so the size cap only ever counts and evicts unpinned images.

In testing, a full set in two languages (516 scans) plus a Japanese set (210 scans) took about 7 seconds and 14 MB.

## Browsing

The Cards tab browses the catalog on the device, so it works offline (layout and components: `docs/ui.md` → Cards):

- **Catalogs:** an `IonSegment` switches between the international and the Asian catalog. Sets are grouped by series, newest first. On desktop the list stays beside the selected set (`IonSplitPane`).
- **Set page:** a card grid in the current language; images load as they scroll into view and are cached ([Images on the device](#images-on-the-device)). The header has the language switch and "Download images" (this set's language, or all its languages), plus Remove.
- **Card detail:** a modal paging through the set (Swiper with virtual slides: swipe, or arrow keys on desktop), with the large scan and the full card text in the current language. Energy symbols in costs and rules text (`{P}`, `{R}`, …) are icons.
- **Language:** the language picked in a set or card is remembered per catalog (`UserSettings.catalogLanguages`, synced across devices), and every set and card opens in it. The server only checks that entry's shape, so a newer client's catalogs or languages still sync; older clients ignore entries they don't know (`knownCatalogLanguages()`) and keep them when saving; a set that lacks it opens in its first language in display order (English, German, French, Italian, then Japanese and Chinese). Without a scan in that language, another language's is shown with a badge (`displayImage()`). Without any scan, a type-tinted card with the name, HP · stage and set number stands in.

## Search

The Cards tab searches the catalog on the device, so it works offline too (layout and components: `docs/ui.md` → Cards → Search).

- **Search rows:** each card has a slim row in the `catalogCardSearch` store (`CatalogSearchRow`): its names in every language, normalized, plus its number, category, subtype, rarity, types and set. `replaceCatalogSet` writes a set's rows with its cards in one transaction, and `deleteCatalogSet` removes them, so they always match. Rows are built by `catalogSearchRow()`, shared by both engines.
- **Existing catalogs:** a device that downloaded the catalog before search existed has cards but no rows. On first use, `CatalogSearchIndexService` rebuilds them set by set from the stored cards (`reindexCatalogSet`) and records `CATALOG_SEARCH_ROW_VERSION` in sync metadata. Changing what a row holds means bumping that version, which rebuilds every device's rows once; there's no re-download.
- **In memory:** the current catalog's rows (about 24,000 international or 17,000 Asian cards) are loaded into memory once (`CatalogSearchIndexService`) and reloaded when the catalog changes, so each keystroke and filter change is answered without touching storage. Only the cards on screen are read in full (`getCatalogCardsByKey`), 60 at a time, as the results scroll or the card modal pages toward the end of what's loaded.
- **Names** match in any language of the catalog: "Pomdepik" and "Pineco" find the same card. Names and queries are normalized the same way (`normalizeSearchText`): lowercase, without accents, full-width letters made plain, hiragana written as katakana, and punctuation treated as spaces. Every query word must start a word of the name ("rocket mew" finds "Team Rocket's Mewtwo ex"), or the whole query must start the name with its spaces and punctuation left out ("farfetchd"). Japanese and Chinese words match anywhere in the name, since those names have no spaces ("ゾロア" finds "ヒスイのゾロアーク").
- **Numbers:** a query word can also be the card's number in its set, alone or with a name: "meowth 67" finds Meowth numbered 67, and "67" finds every card numbered 67. Numbers (each row keeps the printed `localId`; version 2 of the rows added it) split into letters, digits and letters (`parseCardNumber`: `TG05` is `tg`, 5; `XY67a` is `xy`, 67, `a`). A word matches a number with the same prefix and value, so padding never matters ("67" finds `067`, "tg5" finds `TG05`, but "67" doesn't find `SWSH067`). A query without a suffix finds every suffix ("50" finds `50a` and `50b`). The value must be whole: "6" doesn't find 67. A word matches if it starts a word of the name _or_ is the number, so names with numbers in them still match ("energy removal 2", "cube 01"). Letter-only numbers (`LIG`, Unown's `A`) aren't searchable as numbers. "67/146" isn't understood: it's two words. Neither is a name run into a number ("meowth67" reads as a number with the prefix `meowth`), and rows an older version wrote (from another open tab) have no number until they're rebuilt.
- **Filters:** collection status (owned or missing, see [`collection.md`](collection.md)), category (or a Trainer or Energy subtype), type, rarity, and series or set. A card must match every filter in use, and any value within one. Filters work without a query, across the whole catalog or a single set. Picking a whole category or series covers all its subtypes or sets, including sets added later. Switching catalogs keeps the other filters but drops series and sets, which belong to one catalog.
- **Filter counts:** each filter lists only the values the search leaves cards for, with how many: counted over the cards matching the query and every _other_ filter. A filter's own picks don't narrow its counts, since picking another value of it adds cards (with "Fire" picked, Water still shows its count). Picked values stay listed even at 0. Without a query or filters, the counts are the whole catalog's.
- **Order:** results follow the sets list (newest set first), then the card's number in its set.
- **Recent searches:** the last 10 queries (not filters), newest first and without repeats, are kept on the device (`pokepaper.cards.recentSearches`, `RecentSearchesService`), not synced, and shared by every search screen.
- **One search per screen:** `CatalogSearchService` holds a screen's query, filters and results over the shared rows. The Cards tab uses the root instance. Another search screen (a deck's Add cards, see [`decks.md`](decks.md)) lists it in its component `providers` for a search of its own; the search components it hosts open their filter sheet and pickers with their own injector (Ionic's `injector` overlay option), so those use the host's search too. The catalog (International or Japan & Asia) is shared: it's one remembered setting.

## Rarity symbols

Rarities show their symbol before the name, in the set checklist, the card detail and the rarity filter (`rarityIcon()` in `src/app/features/cards/rarity.ts`, images in `src/assets/rarity/`). TCGdex names rarities in English in every region, so the symbol depends on the catalog too:

- **International:** the printed symbols: ● Common, ◆ Uncommon, ★ Rare, and the Scarlet & Violet stars (black ★★ Double rare, silver ★★ Ultra Rare, gold ★ / ★★ / ★★★ Illustration, Special illustration and Hyper rare), plus ACE SPEC, Shiny, Mega, Black White, Futuristic, RGB, Amazing (the rainbow "A"), Classic Collection (★C), Pikachu Rare (Pikachu's head) and Promo. Holo, V/VMAX/VSTAR, LV.X, PRIME, LEGEND, Radiant, Secret and Full Art Trainer rares show the plain ★.
- **Asian:** Japanese cards print letter codes, so rarities map to them: Common C, Uncommon U, Rare R, Double rare RR, Triple Rare RRR, Illustration rare AR, Special illustration rare SAR, Ultra Rare SR (and the late Sword & Shield "Holo Rare" full arts), Hyper rare HR, Secret Rare UR, Mega Hyper Rare UR (MUR in the Mega Evolution series), Promo PR, plus CHR, CSR, ACE, K (Radiant), BWR, FUR, S, MA and Shining (the "Shiny Ultra Rare" cards of Shining Legends). Sets from before Black & White (PMCG, neo, VS, web, e, PCG) printed ●◆★, so they get the international symbols, with every rare as ★. The rarity filter has no set to go by, so it shows each rarity's most common meaning: the modern codes, except Holo Rare and Shiny rare, which are almost all on older cards and show ★. In older sets, a rarity that isn't a known rare shows text only.
- **TCG Pocket:** its own symbols, repeated as in the game: ◆ ×1–4, ★ ×1–3, shiny ×1–2, and the crown.

Images are 48 px tall (widths in `RARITY_ICON_WIDTHS`, which a spec checks against the files, so rows keep the symbol's space while it loads), outlined in white where the source wasn't so they show in dark mode, and prefetched by the service worker. Low-resolution sources (the Japanese codes, ★C) were enlarged and look soft.

**Not covered yet** (text only, to address later):

- **Cards without a rarity:** 2,944 marked "None" (starter decks, high-class packs, basic Energy) and 3,900 Asian cards without a value (mostly Chinese sets, Shiny Treasure ex and Shiny Star V). Some are gaps in TCGdex's data: Crimson Haze (SV5a) has none, and the international 30th Classic Collection (30th-c) is all "None", so it doesn't get ★C.
- **Unverified mappings:** Celebrations Classic Collection (cel25cc, 25 cards) shows ★C, but TCGdex has no scans to confirm the English printings use it. Full Art Trainer (Silver Tempest Trainer Gallery TG23–TG28) shows the plain ★ on a guess, for the same reason.
- **Unused images:** `jp/ssr` and `jp/tr` match no TCGdex rarity; `jp/s` only shows if TCGdex adds rarities to the Japanese shiny sets.
- **Rarities with no symbol in a region:** a rarity that isn't in its region's table (a new TCGdex name, say) shows text only until it's added.

## Storage

The catalog lives in **`catalog.db`**, next to `pokepaper.db` in `DATA_DIR`, with its own migrations in `server/src/catalog/migrations/`. It holds no user data and can be rebuilt from TCGdex (and Cardmarket's downloads), so it's **not included in the server's backups** (it would add about 120 MB to each). Cardmarket matches made by hand live in `pokepaper.db`, which is backed up. To rebuild it from scratch, stop the server, delete `catalog.db` (and any `catalog.db-wal` / `catalog.db-shm`), and start it again: the first run is a full refresh.

Cached images live in `DATA_DIR/images/catalog/` and are also rebuildable (delete the folder any time). The folder only grows with images someone actually viewed or downloaded: about 18 KB per grid image and 75 KB per detail image. Every grid image in all seven languages would be about 2 GB.

## Configuration

| Variable                       | Default                      | Purpose                                                                                                                               |
| ------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `CATALOG_SYNC_ENABLED`         | `true`                       | Run the scheduled import                                                                                                              |
| `CATALOG_LANGUAGES`            | `en,fr,it,de,ja,zh-tw,zh-cn` | Languages to import (comma-separated TCGdex codes)                                                                                    |
| `CATALOG_REFRESH_HOURS`        | `24`                         | Hours between imports (1–168)                                                                                                         |
| `CATALOG_FULL_REFRESH_DAYS`    | `7`                          | A run is a full refresh when the last one is at least this old (1–365)                                                                |
| `CATALOG_PRICES_REFRESH_HOURS` | `24`                         | A run refreshes prices when the last price pass started at least this long ago (1–168); never more often than `CATALOG_REFRESH_HOURS` |

## Attribution

Card data: [TCGdex](https://github.com/tcgdex/cards-database) (MIT License). Prices: Cardmarket's price guide (products matched to cards via TCGdex, or by hand from Cardmarket's product list). Exchange rates: European Central Bank euro reference rates. Energy symbol icons: from ilkcmp's [Neo Neo Blank Symbolsheet](https://www.deviantart.com/ilkcmp/art/Neo-Neo-Blank-Symbolsheet-486883197) (free for non-commercial use). Rarity symbol icons: collected from community sources. Card images, energy and rarity symbols, and names are © The Pokémon Company, Nintendo, Game Freak and Creatures. PokePaper is a personal, non-commercial project not affiliated with them.
