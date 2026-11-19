# Decks

PokePaper lets you build decks from the catalog: named lists of card printings, each with a copy count, checked against a format.

Status: storage and sync are implemented. The Decks tab screens, format checks and "owned vs. needed" are next.

## Design

- **Slots are exact printings.** A deck lists catalog cards (region + card ID, e.g. `intl` `sv03-125`), like a printed decklist, so it shows that printing's art and can match your collection.
- **Each deck has a format:** Standard, Expanded or Unlimited. Rule breaks (not 60 cards, more than 4 copies of a card name across printings with basic Energy exempt, cards not legal in the format) will be **warnings, not errors**: a deck in progress always saves. Legality comes from the catalog (TCGdex's `legal.standard` / `legal.expanded`).
- **Owned vs. needed counts copies in any language.** An English and a German copy of a printing both count toward a deck.

## Data model

A **deck** syncs whole:

| Field       | Example                       | Notes                                                                          |
| ----------- | ----------------------------- | ------------------------------------------------------------------------------ |
| `id`        | `6f1c2c1e-…`                  | Client-generated UUID, also the sync entity ID                                 |
| `name`      | `Charizard ex`                | 1 to 100 characters, not blank (trimmed by the app)                            |
| `format`    | `standard`                    | `standard`, `expanded` or `unlimited`. Unknown values sync, shown as Unlimited |
| `cards`     | `[{ region, cardId, count }]` | Up to 200 slots, in the order they were added; each printing at most once      |
| `createdAt` | `2026-11-19T10:00:00.000Z`    | UTC, as `toISOString()` writes it                                              |
| `updatedAt` | `2026-11-19T10:05:00.000Z`    | Moves forward with every change (the deck list sorts by it)                    |

A slot's `count` is 1 to 99, well above any format's limit, since rule breaks are only warnings. A count of 0 removes the slot.

## Sync

Each deck syncs as one entity (`entityType: 'deck'`, entity ID = `id`), following the rules in [`sync.md`](sync.md): full state on every write, newest write wins per deck, deletes kept as server tombstones.

- **Concurrent edits don't merge.** If two devices change the same deck while offline, the later save wins whole, including its card list. That's rare for one person, and per-slot entities would make every deck read a join.
- **Validation is shape only** (`isDeck`, `isDeckId`). The server checks field types and bounds, that no printing is listed twice, and that an upsert's ID matches its payload. It doesn't check that cards exist or that the deck follows its format.

## On the device

Decks live in the `decks` store (Dexie version 6, SQLite schema version 6). `LocalUserDataRepository.saveDeck` and `deleteDeck` write the deck and queue its sync operation in one transaction.

`DeckService` keeps every deck in memory, so screens read them synchronously:

- `decks`: every deck, most recently changed first.
- `deck(id)`: one deck.
- `create(name, format)`, `update(id, { name, format })`, `setCardCount(id, card, count)`, `remove(id)`: shown at once, then saved in order. A failed save shows the saved decks again and rejects, so a screen can say so. Changes to a deck reject until decks have loaded (`loaded`), since it isn't known yet.
- Pulled changes reload the decks.
