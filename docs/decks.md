# Decks

PokePaper lets you build decks from the catalog: named lists of card printings, each with a copy count, checked against a format.

Status: storage, sync, the Decks tab screens (deck list, deck page, Add cards), format checks, owned vs. needed, cover cards and the Considering pile are implemented.

## Design

- **Slots are exact printings.** A deck lists catalog cards (region + card ID, e.g. `intl` `sv03-125`), like a printed decklist, so it shows that printing's art and can match your collection.
- **Each deck has a format:** Standard, Expanded or Unlimited, checked against the rules below. The copy limit is enforced as you add cards; everything else is a **warning, not an error**: a deck in progress always saves.
- **Owned vs. needed counts copies of any identical printing, in any language** (see Owned vs. needed below).

## Format rules

The rules come from the official documents, not from memory or the catalog:

- **Handbook:** [Play! Pokémon TCG Tournament Handbook](https://www.pokemon.com/static-assets/content-assets/cms2/pdf/play-pokemon/rules/play-pokemon-tcg-tournament-handbook-en.pdf), revised August 26, 2026 (§2.3 languages, §4 Constructed formats).
- **Rulebook:** [Pokémon TCG rulebook](https://www.pokemon.com/static-assets/content-assets/cms2/pdf/trading-card-game/rulebook/dlr_rulebook_en.pdf), last updated November 2026 (Deck Building, card names, and the ACE SPEC, Radiant Pokémon and Prism Star appendices).
- **Banned list:** [Pokémon TCG Banned Card List](https://www.pokemon.com/us/play-pokemon/about/pokemon-tcg-banned-card-list), checked November 19, 2026.

### Every format

These apply to Standard, Expanded and Unlimited alike (handbook §4, rulebook Deck Building):

- **Exactly 60 cards.**
- **At most 4 cards with the same name**, by the card's English name, across printings. **Basic Energy is exempt.** What counts as the same name (rulebook):
  - Different attacks don't matter: 4 "Pignite" in total, whatever the printing.
  - Suffixes are part of the name: Miraidon and Miraidon ex are different, as are ex, EX, GX and V. So are owner and region names (Meowth, Alolan Meowth, Rocket's Meowth, Iono's Tadbulb) and "Radiant" (4 Greninja and 1 Radiant Greninja is fine).
  - Levels aren't part of the name (Gengar, Gengar LV. 43 and Gengar LV.X are all "Gengar"), and neither is δ (Delta Species).
  - Both halves of a Legendary Stadium, and all four pieces of a V-UNION, share one name.
- **At least one Basic Pokémon.**
- **One ACE SPEC card in total**, not one of each (rulebook appendix 4).
- **One Radiant Pokémon in total** (rulebook appendix 9).
- **One copy of each Prism Star (◇) card**; different Prism Star cards may be combined (rulebook appendix 18).

### Standard and Expanded

- **Standard:** cards with regulation marks **H, I and J** (G left Standard in April 2026).
- **Expanded:** regulation marks **D to J**, plus the Black & White, XY and Sun & Moon series expansions, the McDonald's Collections 2011–2021, the Black & White, XY and Sun & Moon trainer kits, Detective Pikachu, and Black Star promos BW01+, XY01+ and SM158+ (handbook §4.1.1).
- **New sets** become legal on the second Friday after their US release (§4.1.2). The catalog doesn't know release schedules, so a set is treated as legal once its mark is.
- **Reprints** (§4.1.3): any printing of a card is legal if a legal printing has an identical name and functionally identical text. So a G-mark Ultra Ball is Standard-legal because I-mark reprints exist.
- **Banned:** nothing in Standard. Expanded bans 26 cards, listed by printing (set and number): 27 entries, since two Lost Thunder Unown are listed separately and no other Unown is banned. That's 48 printings in the catalog (Reset Stamp 206a/236 isn't in it).
- **Languages** (§2.1, §2.3): Japanese cards count as marked, because their backs differ from every other language, so they aren't tournament-legal. Europe allows English, French, German, Italian, Portuguese and Spanish.

### Unlimited

Any card released in the US, with no bans (handbook §4.2). The deck rules above still apply.

### How PokePaper applies them

- **Legality is worked out by PokePaper,** not taken from TCGdex's `legal` flags. Those follow each printing's mark only: they don't apply the reprint rule (G-mark Ultra Ball is flagged not Standard-legal), and they have errors (`sv04-266` Reversal Energy, G-mark, is flagged Standard-legal).
- **Reprints are matched by English name and rules text:** a printing is legal if one with a legal mark (or set) has the same English name and the same English rules text (attacks, abilities, effect, HP, types and so on). Reworded but functionally identical reprints, like the handbook's Copycat example, aren't recognized and get a warning.
- **Basic Energy is always legal:** most printings have no regulation mark, and the handbook doesn't say otherwise. It's recognized by both TCGdex's `energyType` and its English name ("Fire Energy", "Basic Fire Energy"; `basicEnergyTypeOf`), since TCGdex marks some special Energy (Prism Energy) as basic and older special Energy are named plain "Darkness Energy" or "Metal Energy"; a Japan & Asia printing goes by `energyType` alone.
- **A missing mark in a series that prints them** (Sword & Shield, Scarlet & Violet, Mega Evolution) is a gap in TCGdex's data, typically a set that just came out, so that printing's TCGdex flags are used. In November 2026 that covers Delta Reign (released November 6, legal from November 20 by §4.1.2: TCGdex says not yet Standard-legal) and a few promos.
- **SM Black Star promos below SM158** aren't Expanded-legal (§4.1.1), though TCGdex flags them legal.
- **TCG Pocket cards** (the digital game, TCGdex series `tcgp`) are never legal and never count as reprints; a deck holding one gets a "digital only" warning in every format.
- **ACE SPEC and Radiant cards** are recognized by TCGdex's rarity ("ACE SPEC Rare", "Radiant Rare"). Black & White-era ACE SPEC cards are labeled plain "Rare" by TCGdex, so they're listed explicitly: Computer Search, Crystal Edge, Crystal Wall, Gold Potion (Boundaries Crossed), Dowsing Machine, Scramble Switch, Victory Piece (Plasma Storm), Life Dew, Rock Guard (Plasma Freeze), G Booster, G Scope, Master Ball, Scoop Up Cyclone (Plasma Blast). That list isn't from an official document (the rulebook names none, and Bulbapedia refused the fetch); it matches where ACE SPEC cards sit in each set, after the Uncommons and before the Ultra Rares. Prism Star cards are recognized by the ◇ in their name.
- **Names** are compared as TCGdex writes them, with ’ and ' treated alike, and δ (with or without "(Delta Species)") removed wherever it appears ("δ Rainbow Energy" counts as "Rainbow Energy").
- **Japan & Asia printings have no English names** in the catalog, so they're counted by their own name (Japanese first, then Chinese) and can't be matched with international printings of the same card: 4 English and 4 Japanese Pikachu aren't flagged. In Standard and Expanded they're warned about anyway; in Unlimited this is a known gap.
- **Prism Star cards** are capped at 1 copy when adding, like the 4-copy limit.
- **Japan & Asia catalog printings** get a "not tournament-legal" warning in Standard and Expanded decks, not in Unlimited.
- **The 4-copy limit is enforced** when adding (Add cards and the deck page's +), with a message ("A deck holds at most 4 cards named Iono."). A deck that already breaks it (e.g. synced from an older build) shows a warning. Everything else is a warning.
- **Checks** run on the device (`DeckChecksService`): it reads the catalog cards of every deck's printings, works out their legality (searching for reprints only when a printing's own mark or set isn't legal, by English name through the search rows), and checks each deck (`checkDeck` in `deck-rules.ts`) as it changes. A deck's check appears once all its cards have been looked up; a catalog update looks them up again.

## Owned vs. needed

The deck page compares each card with your collection ([`collection.md`](collection.md)):

- **Identical printings count.** A deck card is covered by copies of any printing with the same English name and rules text, the reprint rule from Format rules: your Scarlet & Violet Ultra Ball covers a Paldea Evolved Ultra Ball slot, but a Pikachu with different attacks doesn't cover a Pikachu slot. What a deck-builder asks is "do I have 4 Ultra Balls?", not "do I have this exact printing?".
- **Any language and variant.** English, German and reverse holo copies all count.
- **Shared, never double-counted.** Copies are pooled across a deck's slots of identical printings. Each slot takes copies of its own printing first, then what's left of its identical printings, in deck order. A row says how many came from another printing ("Owned · 2 from another printing"), so you know which physical cards to pull.
- **Same limits as the format rules:** Japan & Asia printings only cover themselves (no English text to match), TCG Pocket cards never count, and reworded reprints aren't recognized. If the search for identical printings fails, each card covers only its own printing (and checks by its own mark) rather than showing nothing.
- **Cards not on this device can't be compared,** so they're never counted as owned: the missing-only view lists them, its count includes them, and the page never says you own every card while any are there. On the Decks list they show as a rule issue ("not on this device, so not checked").
- **Computed on the device** by `ownedCoverage` (`deck-owned.ts`) from the identical printings `DeckChecksService` finds for each deck card and `CollectionService.copiesOfCard` (all languages and variants). It follows the collection as it changes, and appears once the collection has loaded.

## Screens

Layout and components: [`ui.md`](ui.md) → Decks.

- **Decks tab:** every deck, most recently changed first, led by its cover's scan, with its format and card total, how many copies you're missing, and a warning with the number of rules it breaks. The add button names a new deck, which starts as Standard and opens.
- **Deck page:** the deck's format (a choice row) and card total, then the format's rules (what the deck breaks, or that it follows them), then its cards by category (Pokémon, Trainer, Energy) in the order they were added, each with a − count + stepper, what you own of it, and notes for any rule it breaks. Then its Considering pile (see Considering). A toggle shows only the cards you're missing, as a shopping list. Rename and Delete are in the header.
- **Add cards:** card search with its own query and filters (`CatalogSearchService` provided by the modal, see [`catalog.md`](catalog.md) → Search). Tapping a card adds a copy, and its badge (red, bottom right, like the owned badge it replaces there) shows the copies in the deck. Once the deck has 4 cards with that name, a tap says so instead. Opened from the Considering section, it's titled "Add to Considering" and adds to the pile instead, with no copy limit.

## Considering

Each deck has a Considering pile: cards you're trying out, kept apart from the deck so you can swap cards in and out without losing track of them (like a "maybeboard"). The Pokémon TCG has no sideboard in tournament play, so the pile is only a deck-building aid.

- **Apart from the deck:** its cards don't count toward the 60, aren't checked against the format, and don't add to what you're missing (in the deck page or the Decks list). A printing can be both in the deck and in the pile ("3 Nest Ball, maybe a 4th").
- **Moving copies:** each deck row has a button moving one copy to the pile, and each pile row one moving a copy into the deck (`DeckService.moveCopy`, one save). A copy moves into the deck only within its copy limit (4 with the name), saying so like +. In the pile, a printing has at most 99 copies, as in the deck.
- **Owned:** a pile card is covered by spare copies, ones the deck doesn't use ("Own 1 of 2 spare"), worked out by `ownedCoverage` after covering the deck.
- **Synced with the deck** (`considering`, optional, left out when empty); like `cover`, an older build that saves the deck drops it.

## Cover card

Each deck is shown in the Decks list with a cover: the printing chosen with the deck page's "Choose cover" (`DeckService.setCover`), or by default its first Pokémon in deck order. A chosen cover that's no longer in the deck falls back to the default, and so does "First Pokémon" in the picker; a deck without a Pokémon has no cover. `DeckChecksService.coverOf` works it out from the cards it has looked up. The chosen cover syncs with the deck (`cover`, optional); an older build that saves the deck drops it, since a deck syncs whole.

## Data model

A **deck** syncs whole:

| Field         | Example                       | Notes                                                                          |
| ------------- | ----------------------------- | ------------------------------------------------------------------------------ |
| `id`          | `6f1c2c1e-…`                  | Client-generated UUID, also the sync entity ID                                 |
| `name`        | `Charizard ex`                | 1 to 100 characters, not blank (trimmed by the app)                            |
| `format`      | `standard`                    | `standard`, `expanded` or `unlimited`. Unknown values sync, shown as Unlimited |
| `cards`       | `[{ region, cardId, count }]` | Up to 200 slots, in the order they were added; each printing at most once      |
| `createdAt`   | `2026-11-19T10:00:00.000Z`    | UTC, as `toISOString()` writes it                                              |
| `updatedAt`   | `2026-11-19T10:05:00.000Z`    | Moves forward with every change (the deck list sorts by it)                    |
| `cover`       | `{ region, cardId }`          | Optional: the printing shown for the deck in the Decks list (see Cover card)   |
| `considering` | `[{ region, cardId, count }]` | Optional: the Considering pile, bounded like `cards`; left out when empty      |

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
