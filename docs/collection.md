# Collection

PokePaper tracks how many copies of each card you own, per **variant** and **language**. Collection tracking lives in the Cards tab, alongside the catalog: there's no separate Collection screen.

Status: storage, sync and the Cards tab screens (quantity stepper, owned badges, set progress, Collection search filter, set checklist) are implemented, and Settings shows the collection's value.

## Screens

- **Card detail:** a "Collection · English" section, after the attacks and before Details, lists the card's variants (plus any other variant owned), each with a − count + stepper for the copies in the current language. Switch the language button to German to see and edit German copies. A note lists copies in the card's other languages.
- **Card grids** (set page, search results): owned cards get a red badge (bottom right) with the copies owned in the grid's language. Unowned cards look unchanged.
- **Set checklist** (the set page's view button): for entering a collection quickly. Each card is a row with its scan, "001 · Pineco", its rarity, and a button per variant underneath; tapping one toggles 0 ↔ 1 copy in the set's current language (with more copies, the card opens to edit), and "Mark all owned" adds one copy of every unowned card, in its first variant, after a confirmation. Bulk changes are saved together, in one transaction (`setQuantities`, `setCollectionQuantities`).
- **Sets list:** a second line, "87 / 198 owned", appears under "date · 198 cards" once any card of the set is owned, counted in the language the set opens in.
- **Search:** a Collection filter, first among the filters, with Owned and Missing checkboxes (none checked: any card). A card counts as owned with any copy in the language its set opens in, like the badges. Missing plus a Set filter gives that set's want list. Card counts in the other filters follow the pick, as filters do with each other (`SearchFilters.owned`, `CatalogSearchService`). Status is read when the search changes (query, filters, catalog or its language, or once the collection loads), not on every quantity change: a card you add from the modal while Missing is picked stays in the results, with its badge, until the next search change, so the list the modal pages through doesn't reshuffle.
- **Settings → Collection value:** what each catalog's copies are worth at Cardmarket prices (see [Value](#value)).
- The old Collection tab is gone; `/tabs/collection` redirects to Cards. UI details are in [`ui.md`](ui.md) → Cards.

## Value

Settings' "Collection value" section (after Sync, before Passkeys) has a row per catalog with copies ("International", "Japan & Asia"): "1,234 cards · 12 without a price" and its value in euros, then a Total row when both catalogs have copies, and a note: "Cardmarket price trends in euros, for any language and condition. Updated Nov 21, 2026." (the newest price used). It reads "No cards in your collection yet" for an empty collection. A Currency choice row picks the currency every price in the app is shown in (docs/catalog.md → Currencies); converted, the note says "converted from euros at the ECB rate of Nov 20, 2026", and while the picked currency has no rate yet, "Shown in euros until exchange rates are downloaded".

- **Every language counts,** unlike badges and set progress: the value is what the whole collection is worth, and a Cardmarket price covers every language of its catalog (docs/catalog.md → Prices).
- **A copy's price** (`variantFigures`, `headlinePrice`): normal and holo copies take the base finish's price (Cardmarket prices a holo-only card as its base product), reverse holos the reverse holo's. Each is the trend, else the 30-day average, as in card detail. First edition and W promo copies have no Cardmarket price of their own. Card detail hides reverse holo figures for cards that can't come in one (docs/catalog.md → Reverse holo figures), but a reverse holo copy is still valued at them: you only own one of a card TCGdex lists in reverse holo. In a set from before reverse holos existed (May 2002), which TCGdex flags for a few cards, the copy is valued at the base finish's price instead (`beforeReverseHolos`).
- **Copies without a price** (Cardmarket doesn't price the card, the variant has no price, or the card's prices aren't on this device yet) are counted, not valued, so the total never silently drops them.
- Values are summed in cents. `collectionValue` computes them from `CollectionService.ownedEntries` and the prices read in one batch (`CatalogPriceService.pricesByKey`, `getCatalogPricesByKey`). The section recalculates when the collection or the stored prices change.

## Data model

A **collection entry** is one card in one variant and one language, with a quantity:

| Field      | Example    | Notes                                                                              |
| ---------- | ---------- | ---------------------------------------------------------------------------------- |
| `region`   | `intl`     | The card's catalog (docs/catalog.md: a card is identified by region + ID)          |
| `cardId`   | `sv01-001` |                                                                                    |
| `setId`    | `sv01`     | Stored on the entry so set progress needs no catalog lookup                        |
| `variant`  | `reverse`  | `normal`, `reverse`, `holo`, `firstEdition` or `wPromo` (TCGdex's `variants` keys) |
| `language` | `de`       | A language of the card's set                                                       |
| `quantity` | `2`        | 1 to 999                                                                           |

- **Languages are tracked separately.** International card IDs are shared by English, French, Italian and German printings, so the language is part of the entry: an English and a German Pineco are two entries.
- **No zero rows.** Setting a quantity to 0 deletes the entry.
- **Variants come from TCGdex.** A card offers the variants its `variants` flags list, or just `normal` when it lists none. TCGdex's flags have gaps, mostly in older sets.

## Sync

Each entry syncs as its own entity (`entityType: 'collectionEntry'`) with the ID `region:cardId:variant:language` (`collectionEntryId`), following the rules in [`sync.md`](sync.md): full state on every write, newest write wins per entry, deletes kept as server tombstones.

- **Concurrent edits don't add up.** If two devices change the same entry while offline, the later write wins: +1 on each gives 1, not 2. That's rare for one person, and keeping one entity per copy instead would make storage and queries heavier.
- **Validation is shape only** (`isCollectionEntry`, `isCollectionEntryId`). The server checks field types and bounds, that the quantity is a whole number from 1 to 999, and that an upsert's ID matches its payload. It doesn't check the card exists, so variants or languages a newer app adds still sync. `region`, `variant` and `language` can't contain `:`, which keeps IDs unambiguous.

## On the device

Entries live in the `collection` store (Dexie version 5, SQLite schema version 5). `LocalUserDataRepository.setCollectionQuantity` writes or deletes the entry and queues its sync operation in one transaction.

`CollectionService` keeps the whole collection in memory (a large collection is a few thousand small entries), so screens read it synchronously. Counts include only variants and languages this build knows (others stay stored and synced), so every counted copy has a stepper. `loaded` turns true once storage has been read; steppers stay disabled until then, since a change made while counts still read 0 would overwrite the stored quantity:

- `quantity(target)`: copies of one card, variant and language.
- `cardTotal(region, cardId, language)`: a card's copies in one language, across variants (the owned badge).
- `otherLanguages(region, cardId, language)`: a card's copies in its other languages, in display order.
- `ownedInSet(region, setId, language)`: distinct cards of a set owned in one language, any variant (set progress).
- `setQuantity(target, quantity)`: shown at once, then saved in order. A failed save shows the saved collection again. Pulled changes reload the collection.

**Badges and progress follow the language you're viewing.** Switch a set to German and its badges and progress count your German copies.
