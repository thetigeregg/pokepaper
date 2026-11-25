import type { CatalogCard } from '@pokepaper/shared';
import { cardmarketSearchText, type CardmarketProduct } from './store.js';

/**
 * Whether TCGdex's Cardmarket product for a card is that card
 * (docs/catalog.md → Checking TCGdex's products):
 *
 * - `ok`: named like the card, sharing an attack or ability when both list any.
 * - `other_card`: named for another card (Team Magma vs Team Aqua's Maxie
 *   linked to a Psyduck).
 * - `other_printing`: the card's name but none of its attacks or abilities,
 *   another printing of it (HeartGold & SoulSilver's Typhlosion Prime linked
 *   to the plain Typhlosion).
 * - `unchecked`: the card has no English text to compare (Cardmarket names
 *   products in English).
 */
export type ProductLinkCheck = 'ok' | 'unchecked' | 'other_card' | 'other_printing';

/**
 * How alike two names must be (1 − edit distance ÷ the longer length) to be
 * taken as one spelled two ways: "Adventure Lantern" and "Adventuring
 * Lantern", "Star Cipher" and "Star Cypher".
 */
export const MIN_NAME_SIMILARITY = 0.75;
/** Names shorter than this are compared exactly (`similar`). */
const MIN_SIMILAR_LENGTH = 6;

/** Bracketed words naming one half of a split card ("Ho-Oh LEGEND [Top]"), not its moves. */
const CARD_HALVES = new Set(['top', 'bottom', 'left', 'right']);

/**
 * A bracketed entry shaped like a tag: a set code of up to three capitals
 * or with a digit or hyphen ("ESP", "151", "30C", "SV2D", "SV-P", "s10a"),
 * or a letter ("A"). Unown's four-letter Poké-Powers ("HEAL", "DARK") are
 * moves. Only a bracket of nothing else is taken for tags (`moveBrackets`):
 * "Tohoku's Pikachu [SV-P]"; beside moves ("Bulbasaur [Leech Seed | MEP]")
 * the moves decide anyway.
 */
const TAG = /^(?:[A-Z]{1,3}|[A-Z0-9]*\d[A-Z0-9]*|[A-Z0-9]{1,4}-[A-Z0-9]{1,2}|[a-z]{1,3}\d+[a-z]?)$/;

/**
 * Checks a card's Cardmarket product against it, by Cardmarket's product
 * name: the card's name before any bracket ("Staraptor [FB] Lv.50 [Quick
 * Attack | Whirlwind]", `namesMatch`), then its attacks and abilities in
 * the brackets ending it (`moveBrackets`), one of which must be alike
 * (`similar`).
 */
export function checkProductLink(
  card: Pick<CatalogCard, 'text'>,
  product: Pick<CardmarketProduct, 'name'>
): ProductLinkCheck {
  const text = card.text.en;
  const name = text ? cardmarketSearchText(text.name) : '';
  const productName = product.name.split('[')[0] ?? '';
  if (!text || !name || !cardmarketSearchText(productName)) {
    return 'unchecked';
  }
  if (!namesMatch(text.name, productName)) {
    return 'other_card';
  }
  const moves = [...text.attacks, ...text.abilities]
    .map((move) => cardmarketSearchText(move.name))
    // McDonald's cards list the Pokémon's own name as an attack in some data.
    .filter((move) => move && move !== name);
  const nameWords = new Set(words(text.name));
  const listed = moveBrackets(product.name)
    .map(cardmarketSearchText)
    // A split card's half, or a tag from the card's name ("Garchomp C [C]").
    .filter((move) => move && !CARD_HALVES.has(move) && !nameWords.has(move));
  if (moves.length === 0 || listed.length === 0) {
    return 'ok';
  }
  return moves.some((move) => listed.some((other) => similar(move, other)))
    ? 'ok'
    : 'other_printing';
}

/**
 * Whether two names are one card's: equal or alike as `cardmarketSearchText`
 * (`similar`: "MMewtwo EX" and "M Mewtwo EX"); else word by word, the
 * shorter's words all in the longer ("Pelipper", "Pelipper Lv.50"; "Legendary
 * Trench", "Legendary Marine Trench"), or one standing for the longer's other
 * words' initials ("Blend Energy GFPD"). Never one name merely inside the
 * other: "N" isn't "Nidoking", nor "Mew" "Mewtwo"; nor Nidoran♀ Nidoran♂
 * (`gender`), though a name without the sign is either.
 */
function namesMatch(a: string, b: string): boolean {
  const [genderA, genderB] = [gender(a), gender(b)];
  if (genderA && genderB && genderA !== genderB) {
    return false;
  }
  if (similar(cardmarketSearchText(a), cardmarketSearchText(b))) {
    return true;
  }
  const [shorter, longer] = [words(a), words(b)].sort((x, y) => x.length - y.length) as [
    string[],
    string[],
  ];
  const shared = shorter.filter((word) => longer.includes(word));
  const initials = longer
    .filter((word) => !shorter.includes(word))
    .map((word) => word.charAt(0))
    .join('');
  // Initials stand in only beside a shared word: "N" isn't Nidoking's initial.
  return shorter.every((word) => longer.includes(word) || (shared.length > 0 && word === initials));
}

/**
 * The gender sign in a name: Nidoran♀ and Nidoran♂ are two cards, which
 * `cardmarketSearchText` (dropping symbols) can't tell apart. Cardmarket
 * writes some as `&female;` / `&male;`, and many without a sign (null, as
 * is a name with both).
 */
function gender(name: string): 'female' | 'male' | null {
  const female = /♀|&female;/.test(name);
  const male = /♂|&male;/.test(name);
  return female === male ? null : female ? 'female' : 'male';
}

/**
 * A name's words, lowercased without accents: "Team Aqua's Walrein" → team,
 * aqua, s, walrein; "Pokémon" → pokemon (the accent removed, not a break).
 */
function words(name: string): string[] {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word);
}

/**
 * The `|`-separated moves in the brackets ending a product name: `Pidgeot
 * [Mirror Move | Feather Lance]`. None when the name doesn't end in
 * brackets ("Staraptor [FB] Lv.50" names a level-up tag), or when they hold
 * only tags (`TAG`: "Tohoku's Pikachu [SV-P]").
 */
function moveBrackets(name: string): string[] {
  const entries = (/\[([^\]]*)\]\s*$/.exec(name)?.[1]?.split('|') ?? []).map((entry) =>
    entry.trim()
  );
  return entries.every((entry) => TAG.test(entry)) ? [] : entries;
}

/**
 * Equal, or alike enough to be one name spelled two ways
 * (`MIN_NAME_SIMILARITY`). Names shorter than `MIN_SIMILAR_LENGTH` must be
 * equal: one letter apart, "Bite" and "Bide" are other moves.
 */
function similar(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  const longer = Math.max(a.length, b.length);
  return (
    Math.min(a.length, b.length) >= MIN_SIMILAR_LENGTH &&
    1 - editDistance(a, b) / longer >= MIN_NAME_SIMILARITY
  );
}

/** Levenshtein distance: insertions, deletions and substitutions turning `a` into `b`. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}
