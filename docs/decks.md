# Decks

PokePaper lets you build decks from the catalog: named lists of card printings, each with a copy count, checked against a format.

Status: storage and sync are implemented. The Decks tab screens, format checks and "owned vs. needed" are next.

## Design

- **Slots are exact printings.** A deck lists catalog cards (region + card ID, e.g. `intl` `sv03-125`), like a printed decklist, so it shows that printing's art and can match your collection.
- **Each deck has a format:** Standard, Expanded or Unlimited. Breaking a format's rules will be a **warning, not an error**: a deck in progress always saves. Nothing checks format rules yet.
- **Format rules and legality are still to be sourced.** Before they're built, the deck-construction rules (deck size, copy limits and their exceptions, ban lists) will be taken from the official Play! Pokémon rules and written up here with sources. The catalog has TCGdex's `legal.standard` / `legal.expanded` flags for every international card, but they aren't verified yet: one G-mark card (`sv04-266`) is flagged Standard-legal, and it's unknown whether the flags follow ban lists and rotations promptly.
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

These bounds only keep synced data sane; they aren't game rules. A slot's `count` is 1 to 99, well above any format's copy limit, since rule breaks will only be warnings. A count of 0 removes the slot.

## Sync

Each deck syncs as one entity (`entityType: 'deck'`, entity ID = `id`), following the rules in [`sync.md`](sync.md): full state on every write, newest write wins per deck, deletes kept as server tombstones.

- **Sync timestamps follow `updatedAt`.** The server keeps the write with the latest `clientTimestamp`, so a save sends the later of now and the deck's `updatedAt`, and a delete the later of now and the deck's last `updatedAt`. If the clock goes back, a newer save still wins.
- **Concurrent edits don't merge.** If two devices change the same deck while offline, the later save wins whole, including its card list. That's rare for one person, and per-slot entities would make every deck read a join.
- **Validation is shape only** (`isDeck`, `isDeckId`). The server checks field types and bounds, that no printing is listed twice, and that an upsert's ID matches its payload. It doesn't check that cards exist or that the deck follows its format.

## On the device

Decks live in the `decks` store (Dexie version 6, SQLite schema version 6). `LocalUserDataRepository.saveDeck` and `deleteDeck` write the deck and queue its sync operation in one transaction.

`DeckService` keeps every deck in memory, so screens read them synchronously:

- `decks`: every deck, most recently changed first.
- `deck(id)`: one deck.
- `create(name, format)`, `update(id, { name, format })`, `setCardCount(id, card, count)`, `remove(id)`: shown at once, then saved in order. Each returns a promise that rejects (never throws) if the change is invalid, its deck isn't known (before `loaded`, or after a pull removed it), or saving fails, so a screen can say so. Adding a printing to a deck with 200 already rejects with a message saying so.
- **A failed save rolls back.** The decks as last saved show again, without depending on storage to reload them. Changes queued behind the failed one are dropped (`DeckChangeDroppedError`): each was built on the failed change and would save it too, since saves carry the whole deck.
- Pulled changes reload the decks.
