import {
  CATALOG_LANGUAGES,
  type AssetPath,
  type CatalogAttack,
  type CatalogCard,
  type CatalogCardText,
  type CatalogFinishes,
  type CatalogLanguage,
  type CatalogLegality,
  type CatalogRegion,
  type CatalogSeries,
  type CatalogSet,
  type CatalogStampedPrinting,
  type CatalogTypeModifier,
  type CatalogVariants,
  type Localized,
  stampedVariant,
} from '@pokepaper/shared';
import { isProductId, parseProductId } from './price-data.js';
import { TCGDEX_ASSET_BASE } from './tcgdex-client.js';

/**
 * TCGdex responses are untrusted input: everything here is checked and
 * bounded before it reaches the database. Unknown fields are dropped.
 */

const MAX_NAME = 200;
const MAX_TEXT = 4000;
const MAX_SHORT = 80;
const MAX_LIST = 30;
const MAX_CARDS_PER_SET = 2000;
const MAX_SETS = 2000;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Trimmed string capped at `max` characters; null when missing or empty. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function int(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isInteger(parsed) && parsed >= 0 && parsed < 100_000
    ? parsed
    : null;
}

function list(value: unknown, max = MAX_LIST): unknown[] {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function strings(value: unknown, max = MAX_SHORT): string[] {
  return list(value)
    .map((entry) => text(entry, max))
    .filter((entry): entry is string => entry !== null);
}

const ASSET_PATH = /^[A-Za-z0-9._~%!-]+(?:\/[A-Za-z0-9._~%!-]+){1,6}$/;

/** A safe relative path on TCGdex's asset host (`fr/sv/sv01/001`): plain segments, no `..`. */
export function isAssetPath(path: string): boolean {
  return path.length <= 300 && ASSET_PATH.test(path) && !path.split('/').includes('..');
}

/** `https://assets.tcgdex.net/fr/sv/sv01/001` → `fr/sv/sv01/001`; null for anything else. */
export function assetPath(value: unknown): AssetPath | null {
  const url = text(value, 300);
  if (!url?.startsWith(TCGDEX_ASSET_BASE)) {
    return null;
  }
  const path = url.slice(TCGDEX_ASSET_BASE.length);
  return isAssetPath(path) ? path : null;
}

// ---------------------------------------------------------------------------
// Raw shapes (validated subsets of TCGdex responses)
// ---------------------------------------------------------------------------

export interface RawSeries {
  id: string;
  name: string;
  logo: AssetPath | null;
}

export interface RawSetBrief {
  id: string;
}

export interface RawCardBrief {
  id: string;
  localId: string;
}

export interface RawSetDetail {
  id: string;
  name: string;
  serieId: string;
  releaseDate: string | null;
  cardCount: { total: number; official: number };
  abbreviation: string | null;
  logo: AssetPath | null;
  symbol: AssetPath | null;
  legal: CatalogLegality;
  cards: RawCardBrief[];
}

export interface RawCard {
  id: string;
  localId: string;
  name: string;
  category: string;
  rarity: string | null;
  hp: number | null;
  types: string[];
  stage: string | null;
  suffix: string | null;
  trainerType: string | null;
  energyType: string | null;
  dexIds: number[];
  retreat: number | null;
  regulationMark: string | null;
  illustrator: string | null;
  variants: CatalogVariants;
  /** TCGplayer's finishes (`pricing.tcgplayer`), when it lists any. */
  tcgplayerFinishes: CatalogFinishes | null;
  /** Stamped versions (`variants_detailed`); names as in the response's language. */
  stamped: CatalogStampedPrinting[];
  legal: CatalogLegality;
  weaknesses: CatalogTypeModifier[];
  resistances: CatalogTypeModifier[];
  attacks: { cost: string[]; damage: string | null; name: string; effect: string | null }[];
  abilities: { type: string; name: string; effect: string | null }[];
  description: string | null;
  effect: string | null;
  evolveFrom: string | null;
  image: AssetPath | null;
  /** Cardmarket's product for the printing (`pricing.cardmarket.idProduct`); not part of the card. */
  idProduct: number | null;
}

/** `GET /{lang}/series`. Invalid entries are dropped; null if the response isn't a list. */
export function parseSeriesList(value: unknown): RawSeries[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return list(value, MAX_SETS).flatMap((entry) => {
    if (!isObject(entry)) {
      return [];
    }
    const id = text(entry['id'], MAX_SHORT);
    const name = text(entry['name'], MAX_NAME);
    return id && name ? [{ id, name, logo: assetPath(entry['logo']) }] : [];
  });
}

/** `GET /{lang}/sets`. */
export function parseSetList(value: unknown): RawSetBrief[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return list(value, MAX_SETS).flatMap((entry) => {
    const id = isObject(entry) ? text(entry['id'], MAX_SHORT) : null;
    return id ? [{ id }] : [];
  });
}

function legality(value: unknown): CatalogLegality {
  const record = isObject(value) ? value : {};
  return { standard: record['standard'] === true, expanded: record['expanded'] === true };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `GET /{lang}/sets/{id}`; null when it isn't a usable set. */
export function parseSetDetail(value: unknown): RawSetDetail | null {
  if (!isObject(value)) {
    return null;
  }
  const id = text(value['id'], MAX_SHORT);
  const name = text(value['name'], MAX_NAME);
  const serieId = isObject(value['serie']) ? text(value['serie']['id'], MAX_SHORT) : null;
  if (!id || !name || !serieId || !Array.isArray(value['cards'])) {
    return null;
  }

  const counts = isObject(value['cardCount']) ? value['cardCount'] : {};
  const releaseDate = text(value['releaseDate'], 10);
  const seen = new Set<string>();
  const cards = list(value['cards'], MAX_CARDS_PER_SET).flatMap((entry) => {
    if (!isObject(entry)) {
      return [];
    }
    const cardId = text(entry['id'], MAX_SHORT);
    const localId = text(entry['localId'], MAX_SHORT);
    if (!cardId || !localId || seen.has(cardId)) {
      return [];
    }
    seen.add(cardId);
    return [{ id: cardId, localId }];
  });

  return {
    id,
    name,
    serieId,
    releaseDate: releaseDate && ISO_DATE.test(releaseDate) ? releaseDate : null,
    cardCount: {
      total: int(counts['total']) ?? cards.length,
      official: int(counts['official']) ?? 0,
    },
    abbreviation: isObject(value['abbreviation'])
      ? text(value['abbreviation']['official'], MAX_SHORT)
      : null,
    logo: assetPath(value['logo']),
    symbol: assetPath(value['symbol']),
    legal: legality(value['legal']),
    cards,
  };
}

function modifiers(value: unknown): CatalogTypeModifier[] {
  return list(value, 10).flatMap((entry) => {
    if (!isObject(entry)) {
      return [];
    }
    const type = text(entry['type'], MAX_SHORT);
    return type ? [{ type, value: text(entry['value'], MAX_SHORT) }] : [];
  });
}

function damage(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : text(value, MAX_SHORT);
}

/**
 * TCGplayer's price entries by finish (TCGdex's `pricing.tcgplayer`), and
 * the finish each one is. `unlimited` and `1st-edition` are WotC-era names.
 */
const TCGPLAYER_FINISHES: Readonly<Record<string, readonly (keyof CatalogFinishes)[]>> = {
  normal: ['normal'],
  unlimited: ['normal'],
  holofoil: ['holo'],
  'unlimited-holofoil': ['holo'],
  'reverse-holofoil': ['reverse'],
  '1st-edition': ['firstEdition', 'normal'],
  '1st-edition-holofoil': ['firstEdition', 'holo'],
};

/** The prices in a TCGplayer entry; one of them makes the entry count. */
const TCGPLAYER_PRICES = ['lowPrice', 'midPrice', 'highPrice', 'marketPrice', 'directLowPrice'];

/**
 * The finishes TCGplayer prices a card in, from the price entries in
 * TCGdex's `pricing.tcgplayer` with at least one price (an empty entry is
 * no evidence); null when it has none it knows.
 */
export function parseTcgplayerFinishes(card: Json): CatalogFinishes | null {
  const pricing = card['pricing'];
  const tcgplayer = isObject(pricing) ? pricing['tcgplayer'] : undefined;
  if (!isObject(tcgplayer)) {
    return null;
  }
  const finishes: CatalogFinishes = {
    normal: false,
    holo: false,
    reverse: false,
    firstEdition: false,
  };
  let known = false;
  for (const [key, entry] of Object.entries(tcgplayer)) {
    const kinds = Object.hasOwn(TCGPLAYER_FINISHES, key) ? TCGPLAYER_FINISHES[key] : undefined;
    const priced =
      isObject(entry) &&
      TCGPLAYER_PRICES.some((field) => {
        const price = entry[field];
        return typeof price === 'number' && Number.isFinite(price) && price > 0;
      });
    if (kinds && priced) {
      known = true;
      for (const kind of kinds) {
        finishes[kind] = true;
      }
    }
  }
  return known ? finishes : null;
}

const STAMPED_TYPES: readonly CatalogStampedPrinting['type'][] = ['normal', 'holo', 'reverse'];
/** Stamps the plain variants already cover (`firstEdition`, `wPromo`). */
const PLAIN_STAMPS = new Set(['1st-edition', 'w-promo']);
const VARIANT_ID = /^[0-9a-z]{1,64}$/;
/** TCGdex's `variantId` for entries it builds from a card's flags (no detailed variants). */
const GENERATED_VARIANT_ID = 'generated';
const SLUG = /^[0-9a-z][0-9a-z-]{0,59}$/;
const SET_LOGO_STAMP = 'set-logo';
const MAX_STAMPED = 30;

function slug(value: unknown): string | null {
  return typeof value === 'string' && SLUG.test(value) ? value : null;
}

/** A detailed variant's finish, if it's one a stamped version can have. */
function stampedType(entry: Json): CatalogStampedPrinting['type'] | undefined {
  return STAMPED_TYPES.find((candidate) => candidate === entry['type']);
}

function standardSize(entry: Json): boolean {
  return entry['size'] === undefined || entry['size'] === 'standard';
}

/** Whether a detailed variant has a stamp the plain variants don't cover. */
function stampedOnly(entry: Json): boolean {
  return !list(entry['stamp'], 10).every(
    (stamp) => typeof stamp === 'string' && PLAIN_STAMPS.has(stamp.toLowerCase())
  );
}

/** A detailed variant's Cardmarket product (`thirdParty.cardmarket`), if any. */
function cardmarketProduct(entry: Json): number | null {
  const thirdParty = entry['thirdParty'];
  const idProduct = isObject(thirdParty) ? thirdParty['cardmarket'] : undefined;
  return isProductId(idProduct) ? idProduct : null;
}

/**
 * A card's stamped versions, from TCGdex's `variants_detailed`
 * (docs/catalog.md → Stamped versions): standard-size entries with a stamp
 * other than 1st edition or W promo, keyed by `variantId`, of a finish the
 * card also has an entry for without one. A stamped entry that's the
 * card's only one of its finish is that finish's plain variant (an EX-era
 * reverse holo, all stamped with the set logo; a promo only ever stamped),
 * which TCGdex's flags already list, and so is a set logo stamp without a
 * product of its own on a card listing no reverse holo (below). TCGdex names stamps in the response's
 * language, so only the region's preferred language is read for them
 * (`mergeCard`); names that aren't slugs (`1. Auflage`) drop the entry.
 */
export function parseStamped(card: Json): CatalogStampedPrinting[] {
  const entries = list(card['variants_detailed'], MAX_STAMPED).filter(isObject);
  const plainTypes = new Set(
    entries.filter((entry) => standardSize(entry) && !stampedOnly(entry)).map(stampedType)
  );
  const plainProducts = new Set(
    entries.filter((entry) => !stampedOnly(entry)).map((entry) => cardmarketProduct(entry))
  );
  const listsReverse = entries.some((entry) => stampedType(entry) === 'reverse');
  const seen = new Set<string>();
  return entries.flatMap((entry) => {
    const variantId = entry['variantId'];
    const type = stampedType(entry);
    const stamps = list(entry['stamp'], 10).map(slug);
    const idProduct = cardmarketProduct(entry);
    // TCGdex lists the EX-era reverse holos of Delta Species to Power
    // Keepers, all stamped with the set's logo, as Normal or Holo with the
    // stamp, without a product of their own, and no reverse holo entry.
    const reverseHolo =
      !listsReverse &&
      stamps.length === 1 &&
      stamps[0] === SET_LOGO_STAMP &&
      (idProduct === null || plainProducts.has(idProduct));
    if (
      reverseHolo ||
      typeof variantId !== 'string' ||
      !VARIANT_ID.test(variantId) ||
      variantId === GENERATED_VARIANT_ID ||
      !type ||
      !plainTypes.has(type) ||
      !standardSize(entry) ||
      stamps.includes(null) ||
      !stamps.some((stamp) => stamp !== null && !PLAIN_STAMPS.has(stamp))
    ) {
      return [];
    }
    const key = stampedVariant(variantId);
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    const subtype = slug(entry['subtype']);
    const foil = slug(entry['foil']);
    return [
      {
        key,
        type,
        stamps: stamps.filter((stamp) => stamp !== null),
        ...(subtype && { subtype }),
        ...(foil && { foil }),
        ...(idProduct !== null && { idProduct }),
      },
    ];
  });
}

/** `GET /{lang}/cards/{id}`; null when it isn't a usable card. */
export function parseCard(value: unknown): RawCard | null {
  if (!isObject(value)) {
    return null;
  }
  const id = text(value['id'], MAX_SHORT);
  const localId = text(value['localId'], MAX_SHORT);
  const name = text(value['name'], MAX_NAME);
  const category = text(value['category'], MAX_SHORT);
  if (!id || !localId || !name || !category) {
    return null;
  }

  const variants = isObject(value['variants']) ? value['variants'] : {};
  return {
    id,
    localId,
    name,
    category,
    rarity: text(value['rarity'], MAX_SHORT),
    hp: int(value['hp']),
    types: strings(value['types']),
    stage: text(value['stage'], MAX_SHORT),
    suffix: text(value['suffix'], MAX_SHORT),
    trainerType: text(value['trainerType'], MAX_SHORT),
    energyType: text(value['energyType'], MAX_SHORT),
    dexIds: list(value['dexId'], 10)
      .map(int)
      .filter((entry): entry is number => entry !== null),
    retreat: int(value['retreat']),
    regulationMark: text(value['regulationMark'], 8),
    illustrator: text(value['illustrator'], MAX_NAME),
    variants: {
      normal: variants['normal'] === true,
      reverse: variants['reverse'] === true,
      holo: variants['holo'] === true,
      firstEdition: variants['firstEdition'] === true,
      wPromo: variants['wPromo'] === true,
    },
    tcgplayerFinishes: parseTcgplayerFinishes(value),
    stamped: parseStamped(value),
    legal: legality(value['legal']),
    weaknesses: modifiers(value['weaknesses']),
    resistances: modifiers(value['resistances']),
    attacks: list(value['attacks'], 10).flatMap((entry) => {
      if (!isObject(entry)) {
        return [];
      }
      const attackName = text(entry['name'], MAX_NAME);
      return attackName
        ? [
            {
              cost: strings(entry['cost'], MAX_SHORT),
              damage: damage(entry['damage']),
              name: attackName,
              effect: text(entry['effect'], MAX_TEXT),
            },
          ]
        : [];
    }),
    abilities: list(value['abilities'], 10).flatMap((entry) => {
      if (!isObject(entry)) {
        return [];
      }
      const abilityName = text(entry['name'], MAX_NAME);
      return abilityName
        ? [
            {
              type: text(entry['type'], MAX_SHORT) ?? 'Ability',
              name: abilityName,
              effect: text(entry['effect'], MAX_TEXT),
            },
          ]
        : [];
    }),
    description: text(value['description'], MAX_TEXT),
    effect: text(value['effect'], MAX_TEXT),
    evolveFrom: text(value['evolveFrom'], MAX_NAME),
    image: assetPath(value['image']),
    idProduct: parseProductId(value),
  };
}

// ---------------------------------------------------------------------------
// Merging languages
// ---------------------------------------------------------------------------

/** Region languages in preference order for language-neutral fields. */
export const CANONICAL_ORDER: Readonly<Record<CatalogRegion, readonly CatalogLanguage[]>> = {
  intl: ['en', 'fr', 'it', 'de'],
  asia: ['ja', 'zh-tw', 'zh-cn'],
};

/**
 * Set languages in which TCGdex gives cards that also exist in other
 * languages another card's text (docs/catalog.md → Misattributed printings).
 * Those printings are left out; cards only that language has stay.
 *
 * - `SV-P` in Traditional Chinese: Taiwan numbers its Scarlet & Violet promos
 *   apart from Japan, but TCGdex filed the Taiwanese names and texts on the
 *   Japanese cards (SV-P-098, Detective Pikachu, carries Latias's).
 */
export const MISATTRIBUTED_PRINTINGS: Readonly<
  Record<CatalogRegion, Readonly<Record<string, readonly CatalogLanguage[]>>>
> = {
  intl: {},
  asia: { 'SV-P': ['zh-tw'] },
};

/**
 * The languages of a card's printings worth importing: `languages` without
 * the set's misattributed ones (`MISATTRIBUTED_PRINTINGS`), unless the card
 * has no other.
 */
export function trustedLanguages<T extends CatalogLanguage>(
  region: CatalogRegion,
  setId: string,
  languages: readonly T[]
): T[] {
  const sets = MISATTRIBUTED_PRINTINGS[region];
  const misattributed = Object.hasOwn(sets, setId) ? sets[setId] : undefined;
  const trusted = languages.filter((language) => !misattributed?.includes(language));
  return trusted.length > 0 ? trusted : [...languages];
}

/**
 * Localized → canonical (English) vocabulary for one language, e.g. `Plante`
 * → `Grass`. Asian-region responses already use English vocabulary, so their
 * map stays empty.
 */
export type Vocabulary = Map<string, string>;

/** Orders `languages` by the canonical preference order. */
export function inLanguageOrder<T extends CatalogLanguage>(languages: Iterable<T>): T[] {
  const wanted = new Set<CatalogLanguage>(languages);
  return CATALOG_LANGUAGES.filter((language) => wanted.has(language)) as T[];
}

function canonical(value: string, vocabulary: Vocabulary | undefined): string;
function canonical(value: string | null, vocabulary: Vocabulary | undefined): string | null;
function canonical(value: string | null, vocabulary: Vocabulary | undefined): string | null {
  return value === null ? null : (vocabulary?.get(value) ?? value);
}

/**
 * Records `localized` → `english` pairs for every vocabulary field the two
 * printings of a card share, so cards TCGdex has only in `localized`'s
 * language can still be filtered by canonical values.
 */
export function learnVocabulary(
  english: RawCard,
  localized: RawCard,
  vocabulary: Vocabulary
): void {
  const pair = (from: string | null | undefined, to: string | null | undefined): void => {
    if (from && to && from !== to) {
      vocabulary.set(from, to);
    }
  };
  const pairLists = (from: readonly string[], to: readonly string[]): void => {
    if (from.length === to.length) {
      from.forEach((value, index) => {
        pair(value, to[index]);
      });
    }
  };

  pair(localized.category, english.category);
  pair(localized.rarity, english.rarity);
  pair(localized.stage, english.stage);
  pair(localized.trainerType, english.trainerType);
  pair(localized.energyType, english.energyType);
  pairLists(localized.types, english.types);
  pairLists(
    localized.weaknesses.map((entry) => entry.type),
    english.weaknesses.map((entry) => entry.type)
  );
  pairLists(
    localized.resistances.map((entry) => entry.type),
    english.resistances.map((entry) => entry.type)
  );
  if (localized.attacks.length === english.attacks.length) {
    localized.attacks.forEach((attack, index) => {
      pairLists(attack.cost, english.attacks[index]?.cost ?? []);
    });
  }
}

type NeutralFields = Omit<
  CatalogCard,
  'region' | 'id' | 'setId' | 'localId' | 'sortIndex' | 'text'
>;

function neutralFields(raw: RawCard, vocabulary: Vocabulary | undefined): NeutralFields {
  const modifier = (entry: CatalogTypeModifier): CatalogTypeModifier => ({
    type: canonical(entry.type, vocabulary),
    value: entry.value,
  });
  return {
    category: canonical(raw.category, vocabulary),
    rarity: canonical(raw.rarity, vocabulary),
    hp: raw.hp,
    types: raw.types.map((type) => canonical(type, vocabulary)),
    stage: canonical(raw.stage, vocabulary),
    suffix: raw.suffix,
    trainerType: canonical(raw.trainerType, vocabulary),
    energyType: canonical(raw.energyType, vocabulary),
    dexIds: raw.dexIds,
    retreat: raw.retreat,
    regulationMark: raw.regulationMark,
    illustrator: raw.illustrator,
    variants: raw.variants,
    ...(raw.tcgplayerFinishes && { tcgplayerFinishes: raw.tcgplayerFinishes }),
    legal: raw.legal,
    weaknesses: raw.weaknesses.map(modifier),
    resistances: raw.resistances.map(modifier),
    attacks: raw.attacks.map((attack): CatalogAttack => ({
      cost: attack.cost.map((cost) => canonical(cost, vocabulary)),
      damage: attack.damage,
    })),
  };
}

function storedNeutralFields(card: CatalogCard): NeutralFields {
  const { region: _r, id: _i, setId: _s, localId: _l, sortIndex: _o, text: _t, ...neutral } = card;
  return neutral;
}

function cardText(raw: RawCard): CatalogCardText {
  return {
    name: raw.name,
    description: raw.description,
    effect: raw.effect,
    evolveFrom: raw.evolveFrom,
    attacks: raw.attacks.map((attack) => ({ name: attack.name, effect: attack.effect })),
    abilities: raw.abilities,
    image: raw.image,
  };
}

export interface MergeCardInput {
  region: CatalogRegion;
  setId: string;
  localId: string;
  sortIndex: number;
  /** Languages the card currently exists in (from the set listings). */
  languages: readonly CatalogLanguage[];
  /** Freshly fetched printings. Languages not here keep their `existing` text. */
  fetched: ReadonlyMap<CatalogLanguage, RawCard>;
  existing: CatalogCard | undefined;
  vocabularies: ReadonlyMap<CatalogLanguage, Vocabulary>;
}

/**
 * Builds one card record from its printings. Language-neutral fields come
 * from the region's preferred language (English for international cards),
 * mapped to canonical values when only another language is available.
 * Returns null when no language has any data.
 */
export function mergeCard(input: MergeCardInput): CatalogCard | null {
  const { region, fetched, existing } = input;
  const languages = inLanguageOrder(input.languages);

  const texts: Localized<CatalogCardText> = {};
  for (const language of languages) {
    const fresh = fetched.get(language);
    const previous = existing?.text[language];
    if (fresh) {
      texts[language] = cardText(fresh);
    } else if (previous) {
      texts[language] = previous;
    }
  }

  const id = existing?.id ?? [...fetched.values()][0]?.id;
  if (!id || Object.keys(texts).length === 0) {
    return null;
  }

  // Language-neutral fields, best source first: a fresh printing in the
  // region's preferred language; the stored record, if the card still has
  // that language (it just wasn't refetched); a fresh printing in another
  // language, mapped to canonical vocabulary; the stored record.
  const preferred = CANONICAL_ORDER[region][0];
  const preferredRaw = fetched.get(preferred);
  const fallback = CANONICAL_ORDER[region].find((candidate) => fetched.has(candidate));
  const fallbackRaw = fallback ? fetched.get(fallback) : undefined;

  let neutral: NeutralFields | null = null;
  if (preferredRaw) {
    neutral = neutralFields(preferredRaw, undefined);
  } else if (existing && languages.includes(preferred)) {
    neutral = storedNeutralFields(existing);
  } else if (fallback && fallbackRaw) {
    neutral = neutralFields(fallbackRaw, input.vocabularies.get(fallback));
  } else if (existing) {
    neutral = storedNeutralFields(existing);
  }
  if (!neutral) {
    return null;
  }
  const { tcgplayerFinishes: fresh, stamped: _stored, ...rest } = neutral;
  const tcgplayerFinishes = keptFinishes(fresh, existing?.tcgplayerFinishes);
  // Stamp names are in the response's language: only the preferred one's
  // are read, else the stored ones are kept.
  const stamped = preferredRaw ? preferredRaw.stamped : (existing?.stamped ?? []);

  return {
    region,
    id,
    setId: input.setId,
    localId: input.localId,
    sortIndex: input.sortIndex,
    ...rest,
    ...(tcgplayerFinishes && { tcgplayerFinishes }),
    ...(stamped.length > 0 && { stamped }),
    text: texts,
  };
}

/**
 * The finishes TCGplayer has listed for a card, fresh or stored: a finish
 * stays once seen. TCGplayer's entries follow its sales, so one can drop
 * out for a while; the printing doesn't, and the card (with its set's
 * hash, which every device downloads by) shouldn't change with it.
 */
function keptFinishes(
  fresh: CatalogFinishes | undefined,
  stored: CatalogFinishes | undefined
): CatalogFinishes | undefined {
  if (!fresh || !stored) {
    return fresh ?? stored;
  }
  return {
    normal: fresh.normal || stored.normal,
    holo: fresh.holo || stored.holo,
    reverse: fresh.reverse || stored.reverse,
    firstEdition: fresh.firstEdition || stored.firstEdition,
  };
}

/** Builds a set record from its per-language details (at least one). */
export function mergeSet(
  region: CatalogRegion,
  details: ReadonlyMap<CatalogLanguage, RawSetDetail>
): CatalogSet | null {
  const languages = inLanguageOrder(details.keys());
  const primary = languages.map((language) => details.get(language)).find((d) => d !== undefined);
  if (!primary) {
    return null;
  }

  const names: Localized<string> = {};
  const logos: Localized<AssetPath> = {};
  for (const language of languages) {
    const detail = details.get(language);
    if (detail) {
      names[language] = detail.name;
      if (detail.logo) {
        logos[language] = detail.logo;
      }
    }
  }

  const all = languages.map((language) => details.get(language)).filter((d) => d !== undefined);
  return {
    region,
    id: primary.id,
    serieId: primary.serieId,
    releaseDate: primary.releaseDate ?? all.find((d) => d.releaseDate)?.releaseDate ?? null,
    cardCount: primary.cardCount,
    abbreviation: primary.abbreviation ?? all.find((d) => d.abbreviation)?.abbreviation ?? null,
    names,
    logos,
    symbol: primary.symbol ?? all.find((d) => d.symbol)?.symbol ?? null,
    legal: primary.legal,
    // Only languages with cards: TCGdex lists some sets as name-only stubs.
    languages: languages.filter((language) => (details.get(language)?.cards.length ?? 0) > 0),
  };
}

/** Builds a region's series from each language's series list. */
export function mergeSeries(
  region: CatalogRegion,
  lists: ReadonlyMap<CatalogLanguage, readonly RawSeries[]>
): CatalogSeries[] {
  const byId = new Map<string, CatalogSeries>();
  for (const language of inLanguageOrder(lists.keys())) {
    for (const entry of lists.get(language) ?? []) {
      const series = byId.get(entry.id) ?? { region, id: entry.id, names: {}, logos: {} };
      series.names[language] = entry.name;
      if (entry.logo) {
        series.logos[language] = entry.logo;
      }
      byId.set(entry.id, series);
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
