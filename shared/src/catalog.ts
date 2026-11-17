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

export type CatalogImageQuality = 'low' | 'high';

/**
 * Same-origin URL of a card scan, served (and cached) by the PokePaper
 * server. Only valid when `card.text[language].image` is set.
 */
export function catalogCardImageUrl(
  card: Pick<CatalogCard, 'region' | 'id'>,
  language: CatalogLanguage,
  quality: CatalogImageQuality
): string {
  return `/images/catalog/cards/${card.region}/${encodeURIComponent(card.id)}/${language}/${quality}.webp`;
}

/** Same-origin URL of a set's logo (per language) or symbol. */
export function catalogSetImageUrl(
  set: Pick<CatalogSet, 'region' | 'id'>,
  image: { kind: 'logo'; language: CatalogLanguage } | { kind: 'symbol' }
): string {
  const base = `/images/catalog/sets/${set.region}/${encodeURIComponent(set.id)}`;
  return image.kind === 'logo' ? `${base}/logo/${image.language}.webp` : `${base}/symbol.webp`;
}
