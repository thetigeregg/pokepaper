# Collection

PokePaper tracks how many copies of each card you own, per **variant** and **language**. Collection tracking lives in the Cards tab, alongside the catalog: there's no separate Collection screen.

Status: storage, sync and the Cards tab screens (quantity stepper, owned badges, set progress) are implemented. An Owned search filter is next.

## Screens

- **Card detail:** a "Collection · English" section, after the attacks and before Details, lists the card's variants, each with a − count + stepper for the copies in the current language. Switch the language button to German to see and edit German copies. A note lists copies in the set's other languages.
- **Card grids** (set page, search results): owned cards get a red badge (bottom right) with the copies owned in the grid's language. Unowned cards look unchanged.
- **Sets list:** a second line, "87 / 198 owned", appears under "date · 198 cards" once any card of the set is owned, counted in the language the set opens in.
- The old Collection tab is gone; `/tabs/collection` redirects to Cards. UI details are in [`ui.md`](ui.md) → Cards.

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

`CollectionService` keeps the whole collection in memory (a large collection is a few thousand small entries), so screens read it synchronously:

- `quantity(target)`: copies of one card, variant and language.
- `cardTotal(region, cardId, language)`: a card's copies in one language, across variants (the owned badge).
- `otherLanguages(…)`: a card's copies in the other languages.
- `ownedInSet(region, setId, language)`: distinct cards of a set owned in one language, any variant (set progress).
- `setQuantity(target, quantity)`: shown at once, then saved in order. A failed save shows the saved collection again. Pulled changes reload the collection.

**Badges and progress follow the language you're viewing.** Switch a set to German and its badges and progress count your German copies.
