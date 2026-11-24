/**
 * Card search text (docs/catalog.md → Search): names and numbers. Names and
 * queries go through the same normalization, so case, accents, full-width
 * letters and hiragana vs katakana never matter.
 */

/** Combining accents (é → e). Kana voicing marks are outside this range, so ガ stays ガ. */
const COMBINING_ACCENTS = /[̀-ͯ]/g;
/** Combining marks still on their own after NFC. */
const STRAY_MARKS = /\p{M}/gu;
const HIRAGANA = /[ぁ-ゖ]/g;
/** Katakana is 0x60 above the matching hiragana. */
const KANA_OFFSET = 0x60;
const SEPARATORS = /[^\p{L}\p{N}]+/gu;
/** Scripts written without spaces between words, matched anywhere in a name. */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/**
 * Lowercase, without accents, hiragana as katakana, and words separated by
 * single spaces (punctuation and symbols count as separators).
 */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFKD') // Splits accents off, and makes full-width and half-width forms plain.
    .replace(COMBINING_ACCENTS, '')
    .normalize('NFC') // Puts kana voicing marks back on their letters.
    .replace(STRAY_MARKS, '') // Any that couldn't go back would split a word.
    .toLowerCase()
    .replace(HIRAGANA, (kana) => String.fromCharCode(kana.charCodeAt(0) + KANA_OFFSET))
    .replace(SEPARATORS, ' ')
    .trim();
}

/** A normalized name, split once for matching many queries against it. */
export interface PreparedName {
  name: string;
  words: string[];
  /** The words run together, so "farfetchd" finds "Farfetch'd". */
  compact: string;
}

export function prepareName(normalized: string): PreparedName {
  const words = normalized.split(' ').filter(Boolean);
  return { name: normalized, words, compact: words.join('') };
}

/**
 * A card number as printed (`localId`), split for matching: `TG05` is `tg`,
 * 5 and no suffix; `XY67a` is `xy`, 67 and `a`.
 */
export interface CardNumber {
  prefix: string;
  value: number;
  suffix: string;
}

/** Every number TCGdex has is letters, digits, letters (`067`, `SWSH067`, `50b`). */
const CARD_NUMBER = /^([a-z]*)(\d+)([a-z]*)$/;

/** The card number in `text`, or null when it isn't one (`Museum`, `LIG`, `pikachu`). */
export function parseCardNumber(text: string): CardNumber | null {
  const match = CARD_NUMBER.exec(normalizeSearchText(text));
  if (!match) {
    return null;
  }
  const [, prefix = '', digits = '', suffix = ''] = match;
  return { prefix, value: Number(digits), suffix };
}

/**
 * Whether a query word names the card's number: the same prefix and value,
 * so padding never matters ("67" finds `067`, "tg5" finds `TG05`). A query
 * without a suffix finds every suffix ("67" finds `67a`); one with a suffix
 * needs it.
 */
function numberMatches(query: CardNumber, card: CardNumber): boolean {
  return (
    query.prefix === card.prefix &&
    query.value === card.value &&
    (query.suffix === '' || query.suffix === card.suffix)
  );
}

/** A query, normalized and split; null when it has nothing to search for. */
export interface PreparedQuery {
  /** `number` is the card number the word could be, if any. */
  words: { text: string; anywhere: boolean; number: CardNumber | null }[];
  compact: string;
}

export function prepareQuery(query: string): PreparedQuery | null {
  const words = normalizeSearchText(query).split(' ').filter(Boolean);
  if (words.length === 0) {
    return null;
  }
  return {
    // Japanese and Chinese names have no spaces, so their words match anywhere.
    words: words.map((text) => ({
      text,
      anywhere: CJK.test(text),
      number: parseCardNumber(text),
    })),
    compact: words.join(''),
  };
}

/**
 * Whether `name` matches: every query word starts a word of the name (or,
 * for Japanese and Chinese, appears anywhere in it), or the whole query
 * starts the name with its spaces and punctuation left out.
 */
export function nameMatches(name: PreparedName, query: PreparedQuery): boolean {
  return cardMatches({ names: [name], number: null }, query);
}

const NO_NAME = prepareName('');

/**
 * Whether a card matches: in one of its names, every query word matches the
 * name (see `nameMatches`) or the card's number ("meowth 67", or just "67").
 * Either will do for a word, so names with numbers in them still match
 * ("energy removal 2").
 */
export function cardMatches(
  card: { names: readonly PreparedName[]; number: CardNumber | null },
  query: PreparedQuery
): boolean {
  const { number } = card;
  return (card.names.length > 0 ? card.names : [NO_NAME]).some(
    (name) =>
      query.words.every(
        ({ text, anywhere, number: queried }) =>
          (anywhere
            ? name.name.includes(text)
            : name.words.some((word) => word.startsWith(text))) ||
          (queried !== null && number !== null && numberMatches(queried, number))
      ) || name.compact.startsWith(query.compact)
  );
}
