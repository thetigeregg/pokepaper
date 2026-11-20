/**
 * Decks (docs/decks.md): named lists of exact card printings with a copy
 * count each. Synced as one entity per deck (`entityType: 'deck'`, entity ID
 * = `Deck.id`), carrying the whole deck on every write, so the newest save
 * of a deck wins as a whole.
 */

/** Formats a deck can be checked against, in display order. */
export const DECK_FORMATS = ['standard', 'expanded', 'unlimited'] as const;
export type DeckFormat = (typeof DECK_FORMATS)[number];

export function isDeckFormat(value: unknown): value is DeckFormat {
  return typeof value === 'string' && (DECK_FORMATS as readonly string[]).includes(value);
}

/**
 * Copies of one printing in a deck. `region` is a plain string on the wire,
 * like a collection entry's: a newer client may know regions this one doesn't.
 */
export interface DeckCard {
  region: string;
  cardId: string;
  /** 1 to `MAX_DECK_CARD_COUNT`. */
  count: number;
}

export interface Deck {
  /** Client-generated (`crypto.randomUUID()`); also the sync entity ID. */
  id: string;
  /** 1 to `MAX_DECK_NAME_LENGTH` characters, not blank. */
  name: string;
  /**
   * A `DeckFormat`, as a plain string on the wire: decks with a format this
   * build doesn't know still sync, and are treated as `unlimited`.
   */
  format: string;
  /** At most `MAX_DECK_SLOTS`, each printing (region + card ID) at most once. */
  cards: DeckCard[];
  /** UTC ISO timestamps, as `Date.prototype.toISOString()` writes them. */
  createdAt: string;
  updatedAt: string;
  /**
   * The printing shown for the deck in the Decks list, when one was chosen.
   * Without one (or once it's no longer in the deck), the first Pokémon is.
   */
  cover?: DeckCover;
  /**
   * Cards being tried out (docs/decks.md → Considering), apart from the deck:
   * not counted, checked against the format or compared with the
   * collection's needs. At most `MAX_DECK_SLOTS`, each printing at most
   * once, and left out when there are none. A printing may be both here and
   * in `cards`.
   */
  considering?: DeckCard[];
}

/** A deck's chosen cover: one of its printings. */
export interface DeckCover {
  region: string;
  cardId: string;
}

export function isDeckCover(value: unknown): value is DeckCover {
  if (!isRecord(value)) {
    return false;
  }
  return isTag(value['region']) && isId(value['cardId']);
}

export const MAX_DECK_NAME_LENGTH = 100;
/**
 * Copies of one printing. Well above any format's limit (4, or 60 basic
 * Energy), since rule breaks are warnings, not errors (docs/decks.md).
 */
export const MAX_DECK_CARD_COUNT = 99;
/** Distinct printings in one deck; a 60-card deck has at most 60. */
export const MAX_DECK_SLOTS = 200;

/** Bounds for `region` and `format`. */
const MAX_TAG_LENGTH = 16;
/** Bounds for `id` and `cardId`. */
const MAX_ID_LENGTH = 64;
/** The form `Date.prototype.toISOString()` produces (UTC, milliseconds). */
const ISO_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** A deck slot's key within its deck: `region:cardId` (`region` never contains `:`). */
export function deckCardKey(card: Pick<DeckCard, 'region' | 'cardId'>): string {
  return `${card.region}:${card.cardId}`;
}

/** Whether `value` can be a deck's ID (and so its sync entity ID). */
export function isDeckId(value: unknown): value is string {
  return isId(value) && !value.includes(':');
}

/** Whether `value` is a valid deck name: not blank, at most `MAX_DECK_NAME_LENGTH` characters. */
export function isDeckName(value: unknown): value is string {
  return (
    typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_DECK_NAME_LENGTH
  );
}

/** Whether `count` is a whole number from 1 to `MAX_DECK_CARD_COUNT`. */
export function isDeckCardCount(count: unknown): count is number {
  return (
    typeof count === 'number' &&
    Number.isInteger(count) &&
    count >= 1 &&
    count <= MAX_DECK_CARD_COUNT
  );
}

export function isDeckCard(value: unknown): value is DeckCard {
  if (!isRecord(value)) {
    return false;
  }
  const { region, cardId, count } = value;
  return isTag(region) && isId(cardId) && isDeckCardCount(count);
}

/** Runtime shape check for deck payloads (used by the server to validate pushes). */
export function isDeck(value: unknown): value is Deck {
  if (!isRecord(value)) {
    return false;
  }
  const { id, name, format, cards, createdAt, updatedAt, cover, considering } = value;
  return (
    (cover === undefined || isDeckCover(cover)) &&
    (considering === undefined || isDeckCardList(considering)) &&
    isDeckId(id) &&
    isDeckName(name) &&
    isTag(format) &&
    isTimestamp(createdAt) &&
    isTimestamp(updatedAt) &&
    isDeckCardList(cards)
  );
}

/** At most `MAX_DECK_SLOTS` valid slots, each printing at most once. */
function isDeckCardList(value: unknown): value is DeckCard[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_DECK_SLOTS &&
    value.every(isDeckCard) &&
    new Set(value.map(deckCardKey)).size === value.length
  );
}

/** A copy of `value` carrying only deck fields (drops anything else a payload had). */
export function deck(value: Deck): Deck {
  const slots = (list: DeckCard[]) =>
    list.map(({ region, cardId, count }) => ({ region, cardId, count }));
  return {
    id: value.id,
    name: value.name,
    format: value.format,
    cards: slots(value.cards),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(value.cover ? { cover: { region: value.cover.region, cardId: value.cover.cardId } } : {}),
    ...(value.considering?.length ? { considering: slots(value.considering) } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTag(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_TAG_LENGTH &&
    !value.includes(':')
  );
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' && ISO_UTC_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value))
  );
}
