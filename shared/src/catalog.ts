/**
 * Card catalog types: the server's stored records (`server/src/catalog/`)
 * and, later, the packs clients download. See docs/catalog.md.
 *
 * TCGdex splits cards into two regions with separate ID spaces. Within a
 * region every language shares one card ID (`sv01-001` is Pineco, Pomdepik
 * and Tannza); across regions IDs can collide (`neo1` exists in both), so a
 * card is identified by `region` + `id`.
 */

export const CATALOG_REGIONS = ['intl', 'asia'] as const;
export type CatalogRegion = (typeof CATALOG_REGIONS)[number];

/** Languages PokePaper can import, in display order. Codes are TCGdex's. */
export const CATALOG_LANGUAGES = ['en', 'fr', 'it', 'de', 'ja', 'zh-tw', 'zh-cn'] as const;
export type CatalogLanguage = (typeof CATALOG_LANGUAGES)[number];

export const CATALOG_LANGUAGE_REGION: Readonly<Record<CatalogLanguage, CatalogRegion>> = {
  en: 'intl',
  fr: 'intl',
  it: 'intl',
  de: 'intl',
  ja: 'asia',
  'zh-tw': 'asia',
  'zh-cn': 'asia',
};

export function isCatalogLanguage(value: unknown): value is CatalogLanguage {
  return typeof value === 'string' && (CATALOG_LANGUAGES as readonly string[]).includes(value);
}

/** Per-language values; a language is absent when TCGdex has no data for it. */
export type Localized<T> = Partial<Record<CatalogLanguage, T>>;

/**
 * Asset paths are relative to TCGdex's asset host, without the quality and
 * extension: `fr/sv/sv01/001` (card), `en/sv/sv01/logo`, `univ/sv/sv01/symbol`.
 */
export type AssetPath = string;

export interface CatalogSeries {
  region: CatalogRegion;
  id: string;
  names: Localized<string>;
  logos: Localized<AssetPath>;
}

export interface CatalogSet {
  region: CatalogRegion;
  id: string;
  serieId: string;
  /** ISO date (`YYYY-MM-DD`), when known. */
  releaseDate: string | null;
  cardCount: { total: number; official: number };
  /** Official abbreviation printed on cards (e.g. `SVI`), when known. */
  abbreviation: string | null;
  names: Localized<string>;
  logos: Localized<AssetPath>;
  symbol: AssetPath | null;
  legal: CatalogLegality;
  /** Languages this set exists in. */
  languages: CatalogLanguage[];
}

export interface CatalogLegality {
  standard: boolean;
  expanded: boolean;
}

export interface CatalogVariants {
  normal: boolean;
  reverse: boolean;
  holo: boolean;
  firstEdition: boolean;
  wPromo: boolean;
}

/**
 * The finishes TCGplayer sells a card in, from TCGdex's
 * `pricing.tcgplayer` (docs/catalog.md → Reverse holo figures): a second
 * opinion on TCGdex's own `variants` flags, which lack reverse holos for
 * whole sets.
 */
export interface CatalogFinishes {
  normal: boolean;
  holo: boolean;
  reverse: boolean;
  firstEdition: boolean;
}

/**
 * A stamped version of a card (a prerelease, league, staff or set logo
 * stamp…), from TCGdex's detailed variants (docs/catalog.md → Stamped
 * versions). Collected under its own variant, `key`.
 */
export interface CatalogStampedPrinting {
  /** The collection variant its copies are counted under (`stampedVariant`). */
  key: string;
  /** The finish under the stamp. */
  type: 'normal' | 'holo' | 'reverse';
  /** TCGdex's stamp names (`pre-release`, `set-logo`…), as listed: at least one. */
  stamps: string[];
  /** TCGdex's subtype (`shadowless`…), when it names one. */
  subtype?: string;
  /** TCGdex's foil pattern (`pokeball`…), when it names one. */
  foil?: string;
  /** The Cardmarket product TCGdex gives it, if any. */
  idProduct?: number;
}

export interface CatalogTypeModifier {
  /** Canonical (English) energy type, e.g. `Fire`. */
  type: string;
  /** As printed, e.g. `×2`, `-30`. */
  value: string | null;
}

/** Language-neutral part of an attack; its text is in `CatalogCardText.attacks` at the same index. */
export interface CatalogAttack {
  /** Canonical (English) energy types. */
  cost: string[];
  /** As printed, e.g. `30`, `50+`, `20×`; null when the attack deals no printed damage. */
  damage: string | null;
}

export interface CatalogCardText {
  name: string;
  /** Pokédex flavor text. */
  description: string | null;
  /** Trainer/Energy rules text. */
  effect: string | null;
  evolveFrom: string | null;
  attacks: { name: string; effect: string | null }[];
  abilities: { type: string; name: string; effect: string | null }[];
  /** Card scan in this language, or null when TCGdex has none. */
  image: AssetPath | null;
  /**
   * Set when `image` is another printing's scan: a basic Energy without one
   * of its own borrows the newest scan of the same Energy type in this
   * language (docs/catalog.md → Basic Energy scans). That printing's card ID.
   */
  imageFrom?: string;
}

/** The basic Energy types, as their cards are named ("Fire Energy", "Basic Fire Energy"). */
export const BASIC_ENERGY_TYPES = [
  'Grass',
  'Fire',
  'Water',
  'Lightning',
  'Psychic',
  'Fighting',
  'Darkness',
  'Metal',
  'Fairy',
] as const;
export type BasicEnergyType = (typeof BASIC_ENERGY_TYPES)[number];

const BASIC_ENERGY_NAME = new RegExp(`^(?:Basic )?(${BASIC_ENERGY_TYPES.join('|')}) Energy$`);

/**
 * The type of a basic Energy card, from its English name, or null for
 * anything else. By name, because TCGdex's `energyType` marks some special
 * Energy (Prism Energy, Ignition Energy) as basic, and many basic Energy
 * have no `types`.
 */
export function basicEnergyType(englishName: string): BasicEnergyType | null {
  const match = BASIC_ENERGY_NAME.exec(englishName.replace(/\s+/g, ' ').trim());
  return match ? (match[1] as BasicEnergyType) : null;
}

/**
 * A card's basic Energy type, or null when it isn't basic Energy: TCGdex's
 * `energyType` must say basic ("Normal") and the English name must match
 * (`basicEnergyType`). Both, because each alone is wrong somewhere: TCGdex
 * marks Prism Energy and Ignition Energy basic, and older special Energy
 * (Neo to HeartGold & SoulSilver) are named plain "Darkness Energy" and
 * "Metal Energy". Null without English text (Japan & Asia printings).
 */
export function basicEnergyTypeOf(
  card: Pick<CatalogCard, 'category' | 'energyType' | 'text'>
): BasicEnergyType | null {
  if (card.category !== 'Energy' || card.energyType !== 'Normal' || !card.text.en) {
    return null;
  }
  return basicEnergyType(card.text.en.name);
}

/**
 * One card printing with every imported language's text. Vocabulary fields
 * (category, rarity, types, stage, …) are canonical English values whatever
 * the language, so filters work across languages.
 */
export interface CatalogCard {
  region: CatalogRegion;
  id: string;
  setId: string;
  /** Number within the set as printed (`001`, `TG05`, …). */
  localId: string;
  /** Position within the set, for display order. */
  sortIndex: number;
  category: string;
  rarity: string | null;
  hp: number | null;
  types: string[];
  stage: string | null;
  /** e.g. `ex`, `V`, `VMAX`. */
  suffix: string | null;
  trainerType: string | null;
  energyType: string | null;
  dexIds: number[];
  retreat: number | null;
  regulationMark: string | null;
  illustrator: string | null;
  variants: CatalogVariants;
  /** Absent when TCGplayer lists no finish for the card (`CatalogFinishes`). */
  tcgplayerFinishes?: CatalogFinishes;
  /** Absent when TCGdex lists no stamped version (`CatalogStampedPrinting`). */
  stamped?: CatalogStampedPrinting[];
  legal: CatalogLegality;
  weaknesses: CatalogTypeModifier[];
  resistances: CatalogTypeModifier[];
  attacks: CatalogAttack[];
  text: Localized<CatalogCardText>;
}

// ---------------------------------------------------------------------------
// Download API (server → app)
// ---------------------------------------------------------------------------

/** One set as listed in the manifest: enough to tell whether a local copy is current. */
export interface CatalogManifestSet {
  region: CatalogRegion;
  id: string;
  /** Changes exactly when the set's pack does. */
  hash: string;
  cardCount: number;
}

/**
 * `GET /api/catalog/manifest`. `version` changes whenever anything in the
 * catalog does, so a client that has seen it can skip the set diff
 * (the response's ETag is derived from it).
 */
export interface CatalogManifest {
  version: number;
  languages: CatalogLanguage[];
  series: CatalogSeries[];
  sets: CatalogManifestSet[];
}

/** `GET /api/catalog/sets/:region/:setId`: a set with all its cards, in display order. */
export interface CatalogSetPack {
  hash: string;
  set: CatalogSet;
  cards: CatalogCard[];
}

/**
 * Cardmarket price guide figures for one finish of a card, in euros. `null`
 * when Cardmarket reports none (it uses 0 for that).
 */
export interface CardmarketFigures {
  /** Cardmarket's price trend: its headline price, smoothed over recent sales. */
  trend: number | null;
  /** Average sale price over the last 7 days. */
  avg7: number | null;
  /** Average sale price over the last 30 days. */
  avg30: number | null;
}

/**
 * A card's Cardmarket prices, as TCGdex reports them. One Cardmarket product
 * covers the printing in every language of its region: an English and a
 * German copy share a price, and so do a Japanese and a Traditional Chinese
 * one with the same card ID.
 */
export interface CatalogCardPrices {
  /** When TCGdex last read Cardmarket's price guide (ISO timestamp). */
  updated: string;
  /**
   * Cardmarket's product ID, when TCGdex reports it: the card's page is
   * `cardmarketProductUrl(idProduct)`. Absent from prices stored before it
   * was sent.
   */
  idProduct?: number;
  /**
   * Set when `idProduct` was matched to the card by hand, in the app's
   * matcher, rather than reported by TCGdex (docs/catalog.md → Matching by hand).
   */
  matchedByHand?: true;
  /** The normal print; for cards printed only as holo, the holo. */
  base: CardmarketFigures | null;
  /** The reverse holo (Cardmarket's "holo" figures). */
  reverseHolo: CardmarketFigures | null;
}

/** A Cardmarket product the matcher offers for a card. */
export interface CardmarketCandidate {
  idProduct: number;
  /**
   * Cardmarket's name for it, with the attacks that tell printings apart in
   * brackets: `MMewtwo EX [Vanishing Strike]`.
   */
  name: string;
  /** When Cardmarket added it (`YYYY-MM-DD`), when known. */
  added: string | null;
  /** In a Cardmarket expansion that other cards of the card's set map to. */
  inSet: boolean;
  /** Its figures in the last price guide; null when it has none. */
  prices: CatalogCardPrices | null;
}

/**
 * `GET /api/catalog/cardmarket/:region/:cardId/candidates[?q=]`: products a
 * card could be matched to. Without `q`, those named like the card in its
 * set's Cardmarket expansions (falling back to the same name anywhere, then
 * to the whole expansion); with `q`, products whose name contains it, its
 * set's expansions first.
 */
export interface CardmarketCandidates {
  /** The card's product now, if any: TCGdex's, or one matched by hand. */
  current: { idProduct: number; matchedByHand: boolean; name: string | null } | null;
  /**
   * TCGdex's product for the card, unless it's another card's or printing's
   * (rejected: docs/catalog.md → Checking TCGdex's products): what the card
   * goes back to when its match by hand is removed. Null when there's none.
   */
  tcgdex: { idProduct: number; name: string | null } | null;
  products: CardmarketCandidate[];
  /** More products matched than `products` holds: narrow the search. */
  truncated: boolean;
  /**
   * Whether `products` are search results. False when they're the
   * suggestions: without `q`, or with one too short to search (fewer than
   * two letters or digits once spaces and punctuation are dropped).
   */
  searched: boolean;
}

/** The longest `q` the candidates route takes (characters). */
export const MAX_CARDMARKET_QUERY_LENGTH = 100;

/** `PUT /api/catalog/cardmarket/:region/:cardId/match` body. */
export interface CardmarketMatchRequest {
  idProduct: number;
}

/**
 * `GET /api/catalog/prices/:region`: every priced card of a region, by card
 * ID. Cards Cardmarket doesn't price are absent.
 */
export interface CatalogPricePack {
  region: CatalogRegion;
  /** Changes whenever the pack does (the response's ETag is derived from it). */
  version: number;
  currency: 'EUR';
  prices: Record<string, CatalogCardPrices>;
}

/**
 * `GET /api/catalog/rates`: the European Central Bank's euro reference
 * rates, published each working day (docs/catalog.md → Currencies).
 */
export interface ExchangeRates {
  /** The day the rates are for (`YYYY-MM-DD`). */
  date: string;
  /** Units of each currency (ISO 4217 code) per euro; the euro itself isn't listed. */
  rates: Record<string, number>;
}

/** An ISO 4217 currency code, as far as its shape goes (`CHF`). */
export function isCurrencyCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value);
}

/** Runtime shape check for `ExchangeRates` (server reading ECB, app reading the API). */
export function isExchangeRates(value: unknown): value is ExchangeRates {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const { date, rates } = value as Record<string, unknown>;
  if (
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    typeof rates !== 'object' ||
    rates === null ||
    Array.isArray(rates)
  ) {
    return false;
  }
  return Object.entries(rates).every(
    ([code, rate]) =>
      isCurrencyCode(code) &&
      code !== 'EUR' &&
      typeof rate === 'number' &&
      Number.isFinite(rate) &&
      rate > 0
  );
}

/**
 * Cardmarket's ID for each catalog language, as its offer filter
 * (`language=`) takes it.
 */
export const CARDMARKET_LANGUAGE_IDS: Readonly<Record<CatalogLanguage, number>> = {
  en: 1,
  fr: 2,
  de: 3,
  it: 5,
  'zh-cn': 6,
  ja: 7,
  'zh-tw': 11,
};

/** Offer filters for a Cardmarket product page. */
export interface CardmarketOfferFilters {
  /** Only offers in this language. */
  language?: CatalogLanguage;
  /** Only reverse holo offers. */
  reverseHolo?: boolean;
}

/**
 * The Cardmarket page of a product (a card printing), with its prices and
 * offers, filtered to a language or to reverse holos when asked.
 */
export function cardmarketProductUrl(
  idProduct: number,
  filters: CardmarketOfferFilters = {}
): string {
  const params = new URLSearchParams({ idProduct: String(idProduct) });
  if (filters.language) {
    params.set('language', String(CARDMARKET_LANGUAGE_IDS[filters.language]));
  }
  if (filters.reverseHolo) {
    params.set('isReverseHolo', 'Y');
  }
  return `https://www.cardmarket.com/en/Pokemon/Products?${params.toString()}`;
}

export type CatalogImageQuality = 'low' | 'high';

/**
 * Same-origin URL of a card scan, served (and cached) by the PokePaper
 * server. Only valid when `card.text[language].image` is set. A borrowed
 * scan (`imageFrom`) gets `?from=` its source, so the app's image cache
 * (keyed by URL) fetches anew when the source changes or the card gets its
 * own scan; the server ignores it.
 */
export function catalogCardImageUrl(
  card: Pick<CatalogCard, 'region' | 'id'> & { text?: CatalogCard['text'] },
  language: CatalogLanguage,
  quality: CatalogImageQuality
): string {
  const from = card.text?.[language]?.imageFrom;
  const url = `/images/catalog/cards/${card.region}/${encodeURIComponent(card.id)}/${language}/${quality}.webp`;
  return from ? `${url}?from=${encodeURIComponent(from)}` : url;
}

/** Same-origin URL of a set's logo (per language) or symbol. */
export function catalogSetImageUrl(
  set: Pick<CatalogSet, 'region' | 'id'>,
  image: { kind: 'logo'; language: CatalogLanguage } | { kind: 'symbol' }
): string {
  const base = `/images/catalog/sets/${set.region}/${encodeURIComponent(set.id)}`;
  return image.kind === 'logo' ? `${base}/logo/${image.language}.webp` : `${base}/symbol.webp`;
}
