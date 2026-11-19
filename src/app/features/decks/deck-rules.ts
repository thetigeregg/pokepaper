import {
  CATALOG_LANGUAGES,
  basicEnergyTypeOf,
  MAX_DECK_CARD_COUNT,
  deckCardKey,
  type CatalogCard,
  type CatalogLanguage,
  type Deck,
  type DeckFormat,
} from '@pokepaper/shared';
import { catalogKey } from '../../core/data/storage-engine';
import { DECK_FORMAT_LABELS, deckCardTotal, deckFormat } from './deck-display';

/**
 * Deck-construction rules and format legality (docs/decks.md → Format
 * rules), from the Play! Pokémon TCG Tournament Handbook (rev. 2026-08-26),
 * the TCG rulebook (Nov 2026) and the official banned list (checked
 * 2026-11-19). Pure functions; `DeckChecksService` feeds them catalog data.
 */

export const DECK_SIZE = 60;
/** Cards with the same name a deck may hold, except basic Energy (handbook §4). */
export const MAX_COPIES_PER_NAME = 4;

/** Regulation marks legal in Standard (handbook §4.1.1). */
const STANDARD_MARKS: ReadonlySet<string> = new Set(['H', 'I', 'J']);
/** Regulation marks legal in Expanded (handbook §4.1.1). */
const EXPANDED_MARKS: ReadonlySet<string> = new Set(['D', 'E', 'F', 'G', 'H', 'I', 'J']);
/** Series whose expansions are Expanded-legal: Black & White, XY, Sun & Moon (TCGdex series IDs). */
const EXPANDED_SERIES: ReadonlySet<string> = new Set(['bw', 'xy', 'sm']);
/**
 * Other Expanded-legal releases (handbook §4.1.1 "Additional Releases"):
 * McDonald's Collections 2011–2021 and the BW, XY and SM trainer kits
 * (Detective Pikachu is in the `sm` series).
 */
const EXPANDED_SET_PATTERN = /^(20(1\d|2[01])(bw|xy|sm|swsh)(-fr)?|tk-(bw|xy|sm)-.+)$/;
/**
 * Series that print a regulation mark on every card (Sword & Shield on).
 * A card from these without one in the catalog is a gap in TCGdex's data
 * (e.g. a set just released), so its `legal` flags are used instead.
 */
const MARKED_SERIES: ReadonlySet<string> = new Set(['swsh', 'sv', 'me']);
/** TCG Pocket, the digital-only game: never legal, and not a physical card. */
export const POCKET_SERIES = 'tcgp';
/** Black Star promo sets in the Expanded series; SM promos count from SM158 (§4.1.1). */
const PROMO_SETS: ReadonlyMap<string, number> = new Map([
  ['bwp', 1],
  ['xyp', 1],
  ['smp', 158],
]);

/**
 * Cards banned in Expanded, by printing (official banned list, checked
 * 2026-11-19; Reset Stamp 206a/236 isn't in the catalog). Standard and
 * Unlimited ban nothing.
 */
const EXPANDED_BANNED: ReadonlySet<string> = new Set(
  [
    'bw3-67',
    'bw5-110', // Archeops
    'sm10-165', // Chip-Chip Ice Axe
    'xy9-98',
    'xy9-98a',
    'xy9-98b', // Delinquent
    'sm12-83', // Duskull
    'sm6-83', // Flabébé
    'swsh2-22',
    'swsh4.5sv-SV013',
    'swsh10tg-TG02',
    'swshp-SWSH022', // Flapple
    'xy7-74', // Forest of Giant Plants
    'bw9-101',
    'bw9-115', // Ghetsis
    'xy7-75',
    'xy7-75a', // Hex Maniac
    'sm12-194',
    'sm12-265', // Island Challenge Amulet
    'sm115-58',
    'sm115-68', // Jessie & James
    'sm10-178',
    'sm115-60', // Lt. Surge's Strategy
    'xy4-99',
    'xy4-118', // Lysandre's Trump Card
    'sm3.5-45',
    'smp-SM85', // Marshadow
    'xy5-133',
    'xy5-158', // Maxie's Hidden Ball Trick
    'swsh7-83',
    'swsh7-185',
    'swsh7-186', // Medicham V
    'xy2-23', // Milotic
    'sm10-78', // Mismagius
    'sm5-114', // Oranguru
    'xy9-109', // Puzzle of Time
    'xy1-124',
    'g1-71', // Red Card
    'sm11-206',
    'sm11-253', // Reset Stamp
    'bw5-62', // Sableye
    'swsh2-165',
    'swsh2-207', // Scoop Up Net
    'xy6-77',
    'xy6-77a',
    'xy6-106', // Shaymin-EX
    'sm8-90',
    'sm8-91', // Unown
  ].map((id) => catalogKey('intl', id))
);

/**
 * Black & White-era ACE SPEC cards, which TCGdex labels plain "Rare"
 * (later ones have the "ACE SPEC Rare" rarity). Not from an official list:
 * known printings, matching where ACE SPEC cards sit in each set (after the
 * Uncommons, before the Ultra Rares). See docs/decks.md.
 */
const BW_ACE_SPECS: ReadonlySet<string> = new Set(
  [
    'bw7-137',
    'bw7-138',
    'bw7-139',
    'bw7-140', // Computer Search, Crystal Edge, Crystal Wall, Gold Potion
    'bw8-128',
    'bw8-129',
    'bw8-130', // Dowsing Machine, Scramble Switch, Victory Piece
    'bw9-107',
    'bw9-108', // Life Dew, Rock Guard
    'bw10-92',
    'bw10-93',
    'bw10-94',
    'bw10-95', // G Booster, G Scope, Master Ball, Scoop Up Cyclone
  ].map((id) => catalogKey('intl', id))
);

/**
 * Whether a card is basic Energy (no copy limit; always legal):
 * `basicEnergyTypeOf`, so neither Prism Energy (marked basic by TCGdex) nor
 * old special "Darkness Energy" counts. A card without English text (Japan &
 * Asia) goes by `energyType` alone.
 */
export function isBasicEnergy(card: CatalogCard): boolean {
  if (card.category !== 'Energy') {
    return false;
  }
  return card.text.en ? basicEnergyTypeOf(card) !== null : card.energyType === 'Normal';
}

export function isBasicPokemon(card: CatalogCard): boolean {
  return card.category === 'Pokemon' && card.stage === 'Basic';
}

export function isAceSpec(card: CatalogCard): boolean {
  return card.rarity === 'ACE SPEC Rare' || BW_ACE_SPECS.has(catalogKey(card.region, card.id));
}

export function isRadiant(card: CatalogCard): boolean {
  return card.rarity === 'Radiant Rare' || englishName(card).startsWith('Radiant ');
}

export function isPrismStar(card: CatalogCard): boolean {
  return englishName(card).includes('◇');
}

/** The card's English name as printed (or its first name, for a card without English text). */
export function englishName(card: CatalogCard): string {
  return tidy(primaryText(card)?.name ?? card.id);
}

/**
 * The card's English text, else its text in the first catalog language it
 * has (fixed order, so printings agree). Japan & Asia printings have no
 * English text, so their names can't be matched with international ones:
 * the copy limit counts each catalog's names apart (docs/decks.md).
 */
function primaryText(card: CatalogCard): CatalogCard['text'][CatalogLanguage] {
  for (const language of CATALOG_LANGUAGES) {
    const text = card.text[language];
    if (text) {
      return text;
    }
  }
  return undefined;
}

/**
 * The name the copy limit counts by (rulebook, "card names"): the English
 * name without a level ("Gengar LV.X" is "Gengar") or δ (Delta Species).
 * Suffixes, owners and forms stay: "Miraidon ex", "Alolan Meowth".
 */
export function ruleName(card: CatalogCard): string {
  return englishName(card)
    .replace(/\s+LV\.\s*(X|\d+)$/i, '')
    .replace(/δ(\s*\(Delta Species\))?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * What makes two printings the same card for the reprint rule (handbook
 * §4.1.3: identical name, functionally identical text): the English name
 * and everything that plays, but not the set, mark, art or rarity. Reworded
 * reprints get different fingerprints (docs/decks.md).
 */
export function rulesFingerprint(card: CatalogCard): string {
  const text = primaryText(card);
  return JSON.stringify([
    englishName(card),
    card.category,
    card.hp,
    card.types,
    card.stage,
    card.suffix,
    card.trainerType,
    card.energyType,
    tidy(text?.evolveFrom ?? null),
    tidy(text?.effect ?? null),
    card.attacks.map((attack, index) => [
      attack.cost,
      attack.damage,
      tidy(text?.attacks[index]?.name ?? null),
      tidy(text?.attacks[index]?.effect ?? null),
    ]),
    (text?.abilities ?? []).map((ability) => [
      ability.type,
      tidy(ability.name),
      tidy(ability.effect),
    ]),
    card.weaknesses,
    card.resistances,
    card.retreat,
  ]);
}

/** Formats checked for legality (Unlimited allows everything). */
export type CheckedFormat = Exclude<DeckFormat, 'unlimited'>;

/** Whether this printing itself is legal in `format`, by its mark or set (not reprints). */
export function printingLegal(
  card: CatalogCard,
  serieId: string | null,
  format: CheckedFormat
): boolean {
  if (serieId === POCKET_SERIES) {
    return false;
  }
  if (isBasicEnergy(card)) {
    return true;
  }
  const mark = (card.regulationMark ?? '').toUpperCase();
  if ((mark === '' || mark === 'NONE') && serieId !== null && MARKED_SERIES.has(serieId)) {
    return card.legal[format];
  }
  if (format === 'standard') {
    return STANDARD_MARKS.has(mark);
  }
  if (EXPANDED_MARKS.has(mark) || EXPANDED_SET_PATTERN.test(card.setId)) {
    return true;
  }
  const promoFrom = PROMO_SETS.get(card.setId);
  if (promoFrom !== undefined) {
    return Number.parseInt(card.localId.replace(/^\D+/, ''), 10) >= promoFrom;
  }
  return serieId !== null && EXPANDED_SERIES.has(serieId);
}

export function isBanned(card: CatalogCard, format: DeckFormat): boolean {
  return format === 'expanded' && EXPANDED_BANNED.has(catalogKey(card.region, card.id));
}

/** A card in a deck as the checks see it: its catalog card (if on this device) and legality. */
export interface CheckedCard {
  card: CatalogCard;
  /** The card's series (TCGdex ID), when its set is on this device. */
  serie: string | null;
  /**
   * Keys of every printing with the card's English name and rules text, its
   * own included (`rulesFingerprint`), for owned vs. needed. Just its own for
   * Japan & Asia printings and TCG Pocket cards.
   */
  printings: readonly string[];
  /** Legal in each format, reprints included (`DeckChecksService`). */
  legal: Record<CheckedFormat, boolean>;
}

/** One rule the deck breaks, shown in the deck page's rules section. */
export interface DeckIssue {
  id: string;
  text: string;
}

/** A card's copy limit in its deck: copies of its name, and how many are allowed. */
export interface NameLimit {
  name: string;
  total: number;
  /** `MAX_COPIES_PER_NAME` (1 for a Prism Star card), or `MAX_DECK_CARD_COUNT` per printing for basic Energy. */
  limit: number;
}

export interface DeckCheck {
  format: DeckFormat;
  issues: DeckIssue[];
  /** Notes for the rows of cards that break a rule, by deck slot key. */
  cardNotes: ReadonlyMap<string, string[]>;
  /** Copies of each card's name (cards on this device), by deck slot key. */
  limits: ReadonlyMap<string, NameLimit>;
}

/**
 * How many copies of `card` the deck may hold, and holds now: 4 with its
 * name across printings (1 for a Prism Star card), or 99 of the printing
 * for basic Energy. `cards` are the deck's catalog cards by slot key; cards
 * not on this device don't count.
 */
export function nameLimit(
  deck: Pick<Deck, 'cards'>,
  cards: ReadonlyMap<string, CatalogCard>,
  card: CatalogCard
): NameLimit {
  const name = ruleName(card);
  if (isBasicEnergy(card)) {
    const key = catalogKey(card.region, card.id);
    const total = deck.cards.find((slot) => deckCardKey(slot) === key)?.count ?? 0;
    return { name, total, limit: MAX_DECK_CARD_COUNT };
  }
  const total = deck.cards.reduce((sum, slot) => {
    const other = cards.get(deckCardKey(slot));
    return other && ruleName(other) === name ? sum + slot.count : sum;
  }, 0);
  return { name, total, limit: isPrismStar(card) ? 1 : MAX_COPIES_PER_NAME };
}

/** Checks `deck` against its format's rules (docs/decks.md → Format rules). */
export function checkDeck(deck: Deck, cards: ReadonlyMap<string, CheckedCard>): DeckCheck {
  const format = deckFormat(deck);
  const label = DECK_FORMAT_LABELS[format];
  const issues: DeckIssue[] = [];
  const cardNotes = new Map<string, string[]>();
  const note = (key: string, text: string) => {
    cardNotes.set(key, [...(cardNotes.get(key) ?? []), text]);
  };
  const plural = (count: number, one: string, many = `${one}s`) =>
    `${String(count)} ${count === 1 ? one : many}`;

  const total = deckCardTotal(deck);
  if (total !== DECK_SIZE) {
    issues.push({ id: 'size', text: `${String(total)} of ${String(DECK_SIZE)} cards` });
  }

  const byName = new Map<string, { total: number; keys: string[]; prism: boolean }>();
  const limits = new Map<string, NameLimit>();
  let unknown = 0;
  let aceSpecs = 0;
  let radiants = 0;
  let basics = 0;
  let illegal = 0;
  let banned = 0;
  let asian = 0;
  let pocket = 0;
  for (const slot of deck.cards) {
    const key = deckCardKey(slot);
    const checked = cards.get(key);
    if (!checked) {
      unknown += slot.count;
      note(key, "Can't be checked: not on this device");
      continue;
    }
    const { card } = checked;
    if (checked.serie === POCKET_SERIES) {
      pocket += slot.count;
      note(key, 'A TCG Pocket card: digital only');
    }
    if (isAceSpec(card)) {
      aceSpecs += slot.count;
    }
    if (isRadiant(card)) {
      radiants += slot.count;
    }
    if (isBasicPokemon(card)) {
      basics += slot.count;
    }
    if (isBasicEnergy(card)) {
      limits.set(key, { name: ruleName(card), total: slot.count, limit: MAX_DECK_CARD_COUNT });
    } else {
      const name = ruleName(card);
      const entry = byName.get(name) ?? { total: 0, keys: [], prism: false };
      entry.total += slot.count;
      entry.keys.push(key);
      entry.prism ||= isPrismStar(card);
      byName.set(name, entry);
    }
    if (format !== 'unlimited') {
      if (card.region !== 'intl') {
        asian += slot.count;
        note(key, 'Not tournament-legal: a Japan & Asia printing');
      } else if (!checked.legal[format] && checked.serie !== POCKET_SERIES) {
        illegal += slot.count;
        note(key, `Not legal in ${label}`);
      }
      if (isBanned(card, format)) {
        banned += slot.count;
        note(key, `Banned in ${label}`);
      }
    }
  }

  for (const [name, entry] of byName) {
    const allowed = entry.prism ? 1 : MAX_COPIES_PER_NAME;
    for (const key of entry.keys) {
      limits.set(key, { name, total: entry.total, limit: allowed });
    }
    if (entry.total > allowed) {
      issues.push({
        id: `copies:${name}`,
        text: `${String(entry.total)} cards named ${name} (${String(allowed)} allowed)`,
      });
      entry.keys.forEach((key) => {
        note(key, `${String(entry.total)} named ${name}, ${String(allowed)} allowed`);
      });
    }
  }
  if (aceSpecs > 1) {
    issues.push({ id: 'ace-spec', text: `${plural(aceSpecs, 'ACE SPEC card')} (1 allowed)` });
  }
  if (radiants > 1) {
    issues.push({ id: 'radiant', text: `${String(radiants)} Radiant Pokémon (1 allowed)` });
  }
  // Only sure when every card could be checked.
  if (basics === 0 && unknown === 0 && deck.cards.length > 0) {
    issues.push({ id: 'basic', text: 'No Basic Pokémon (at least 1 needed)' });
  }
  if (illegal > 0) {
    issues.push({ id: 'legal', text: `${plural(illegal, 'card')} not legal in ${label}` });
  }
  if (banned > 0) {
    issues.push({ id: 'banned', text: `${plural(banned, 'banned card')} in ${label}` });
  }
  if (asian > 0) {
    issues.push({
      id: 'asian',
      text: `${plural(asian, 'Japan & Asia printing')}, not tournament-legal`,
    });
  }
  if (pocket > 0) {
    issues.push({ id: 'pocket', text: `${plural(pocket, 'TCG Pocket card')}, digital only` });
  }
  if (unknown > 0) {
    issues.push({
      id: 'unknown',
      text: `${plural(unknown, 'card')} not on this device, so not checked`,
    });
  }
  return { format, issues, cardNotes, limits };
}

/** Apostrophes and spacing made uniform (TCGdex mixes ’ and '). */
function tidy<T extends string | null>(value: T): T {
  return (value === null ? null : value.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim()) as T;
}
