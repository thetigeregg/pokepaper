import type { CatalogRegion } from '@pokepaper/shared';

/**
 * Rarity symbols (docs/ui.md → Components): which image in `assets/rarity/`
 * a card's rarity shows, and how many times (TCG Pocket repeats its symbol:
 * "Three Diamond" is ◆◆◆). Rarities are TCGdex's English names in every
 * region; Japanese and Chinese cards print letter codes instead of symbols,
 * so the Asian catalog maps to `jp/<code>` (docs/catalog.md → Rarity
 * symbols lists what has no symbol yet).
 */
export interface RarityIcon {
  /** Path under `assets/rarity/`, without `.png`. */
  name: RarityIconName;
  count: number;
  /** The image's width in pixels, at `RARITY_ICON_HEIGHT`. */
  width: number;
}

/** Every image's height in pixels. */
export const RARITY_ICON_HEIGHT = 48;

/**
 * Every image in `assets/rarity/` with its width, so rows reserve the
 * symbol's space before it loads (a spec checks this against the files).
 */
export const RARITY_ICON_WIDTHS = {
  'ace-spec-rare': 50,
  'amazing-rare': 48,
  'black-white-rare': 72,
  'classic-collection': 73,
  common: 48,
  'double-rare': 72,
  'futuristic-rare': 50,
  'hyper-rare': 63,
  'illustration-rare': 50,
  'jp/ace': 98,
  'jp/ar': 78,
  'jp/bwr': 121,
  'jp/c': 43,
  'jp/chr': 111,
  'jp/csr': 98,
  'jp/fur': 108,
  'jp/hr': 76,
  'jp/k': 48,
  'jp/ma': 91,
  'jp/mur': 123,
  'jp/pr': 71,
  'jp/r': 48,
  'jp/rr': 73,
  'jp/rrr': 106,
  'jp/s': 41,
  'jp/sar': 103,
  'jp/sr': 71,
  'jp/ssr': 98,
  'jp/tr': 71,
  'jp/u': 48,
  'jp/ur': 76,
  'mega-attack-rare': 72,
  'mega-hyper-rare': 48,
  'pikachu-rare': 62,
  'pocket/crown': 72,
  'pocket/diamond': 37,
  'pocket/shiny': 43,
  'pocket/star': 51,
  promo: 53,
  rare: 50,
  'rgb-rare': 50,
  shining: 47,
  'shiny-rare': 48,
  'shiny-ultra-rare': 69,
  'special-illustration-rare': 72,
  'ultra-rare': 72,
  uncommon: 48,
} as const satisfies Record<string, number>;

export type RarityIconName = keyof typeof RARITY_ICON_WIDTHS;

const INTERNATIONAL: Readonly<Record<string, RarityIconName>> = {
  Common: 'common',
  Uncommon: 'uncommon',
  Rare: 'rare',
  // Rares that print the plain rare star.
  'Holo Rare': 'rare',
  'Rare Holo': 'rare',
  'Holo Rare V': 'rare',
  'Holo Rare VMAX': 'rare',
  'Holo Rare VSTAR': 'rare',
  'Rare Holo LV.X': 'rare',
  'Rare PRIME': 'rare',
  LEGEND: 'rare',
  'Radiant Rare': 'rare',
  'Secret Rare': 'rare',
  'Full Art Trainer': 'rare',
  'Amazing Rare': 'amazing-rare',
  'Double rare': 'double-rare',
  'Ultra Rare': 'ultra-rare',
  'Illustration rare': 'illustration-rare',
  'Special illustration rare': 'special-illustration-rare',
  'Hyper rare': 'hyper-rare',
  'ACE SPEC Rare': 'ace-spec-rare',
  'Shiny rare': 'shiny-rare',
  'Shiny rare V': 'shiny-rare',
  'Shiny rare VMAX': 'shiny-rare',
  'Shiny Ultra Rare': 'shiny-ultra-rare',
  'Mega Hyper Rare': 'mega-hyper-rare',
  'Mega Attack Rare': 'mega-attack-rare',
  'Black White Rare': 'black-white-rare',
  'Futuristic Rare': 'futuristic-rare',
  'RGB Rare': 'rgb-rare',
  'Classic Collection': 'classic-collection',
  'Pikachu Rare': 'pikachu-rare',
  Promo: 'promo',
};

/** Japanese letter codes (Black & White onward), by TCGdex rarity. */
const JAPANESE: Readonly<Record<string, RarityIconName>> = {
  Common: 'jp/c',
  Uncommon: 'jp/u',
  Rare: 'jp/r',
  'Rare Holo': 'jp/r',
  'Double rare': 'jp/rr',
  'Triple Rare': 'jp/rrr',
  'Illustration rare': 'jp/ar',
  'Special illustration rare': 'jp/sar',
  // Full-art cards: SR. TCGdex calls the late Sword & Shield ones Holo Rare.
  'Ultra Rare': 'jp/sr',
  'Holo Rare': 'jp/sr',
  'Hyper rare': 'jp/hr',
  'Secret Rare': 'jp/ur',
  'Mega Hyper Rare': 'jp/ur',
  'Shiny rare': 'jp/s',
  'Shiny Ultra Rare': 'shining',
  'Character Rare': 'jp/chr',
  'Character Super Rare': 'jp/csr',
  'ACE SPEC Rare': 'jp/ace',
  'Radiant Rare': 'jp/k',
  'Black White Rare': 'jp/bwr',
  'Futuristic Rare': 'jp/fur',
  'Mega Attack Rare': 'jp/ma',
  'Amazing Rare': 'amazing-rare',
  'RGB Rare': 'rgb-rare',
  'Classic Collection': 'classic-collection',
  Promo: 'jp/pr',
};

/** The Mega Evolution series' gold cards are MUR, not UR. */
const MEGA_SERIES: Readonly<Record<string, RarityIconName>> = {
  ...JAPANESE,
  'Mega Hyper Rare': 'jp/mur',
};

/**
 * Asian series from before Black & White: their cards print the
 * international ●◆★ symbols, with every rare as ★.
 */
const SYMBOL_ERA_SERIES = new Set(['PMCG', 'neo', 'VS', 'web', 'e', 'PCG']);
const SYMBOL_ERA: Readonly<Record<string, RarityIconName>> = {
  Common: 'common',
  Uncommon: 'uncommon',
  Rare: 'rare',
  'Holo Rare': 'rare',
  'Rare Holo': 'rare',
  'Secret Rare': 'rare',
  'Ultra Rare': 'rare',
  'Hyper rare': 'rare',
  'Shiny rare': 'rare',
};

/**
 * The rarity filter has no series to go by, so the Asian catalog shows each
 * rarity's most common meaning: letter codes, except Holo Rare and Shiny
 * rare, which are almost all on older ★ cards.
 */
const ASIAN_WITHOUT_SERIES: Readonly<Record<string, RarityIconName>> = {
  ...JAPANESE,
  'Holo Rare': 'rare',
  'Shiny rare': 'rare',
};

/** TCG Pocket's rarities, the same in every region. */
const POCKET: Readonly<Record<string, { name: RarityIconName; count: number }>> = {
  'One Diamond': { name: 'pocket/diamond', count: 1 },
  'Two Diamond': { name: 'pocket/diamond', count: 2 },
  'Three Diamond': { name: 'pocket/diamond', count: 3 },
  'Four Diamond': { name: 'pocket/diamond', count: 4 },
  'One Star': { name: 'pocket/star', count: 1 },
  'Two Star': { name: 'pocket/star', count: 2 },
  'Three Star': { name: 'pocket/star', count: 3 },
  'One Shiny': { name: 'pocket/shiny', count: 1 },
  'Two Shiny': { name: 'pocket/shiny', count: 2 },
  Crown: { name: 'pocket/crown', count: 1 },
};

/**
 * The symbol for `rarity` on a card of `region` and series `seriesId`, or
 * null when it has none ("None", or a rarity missing from its table).
 * Without a series (the rarity filter), see `ASIAN_WITHOUT_SERIES`.
 */
export function rarityIcon(
  rarity: string | null | undefined,
  region: CatalogRegion,
  seriesId?: string
): RarityIcon | null {
  if (!rarity || rarity === 'None') {
    return null;
  }
  const { name, count } = own(POCKET, rarity) ?? {
    name: lookup(rarity, region, seriesId),
    count: 1,
  };
  return name ? { name, count, width: RARITY_ICON_WIDTHS[name] } : null;
}

function lookup(
  rarity: string,
  region: CatalogRegion,
  seriesId: string | undefined
): RarityIconName | null {
  return own(table(region, seriesId), rarity);
}

function table(
  region: CatalogRegion,
  seriesId: string | undefined
): Readonly<Record<string, RarityIconName>> {
  if (region === 'intl') {
    return INTERNATIONAL;
  }
  if (!seriesId) {
    return ASIAN_WITHOUT_SERIES;
  }
  if (SYMBOL_ERA_SERIES.has(seriesId)) {
    return SYMBOL_ERA;
  }
  return seriesId === 'M' ? MEGA_SERIES : JAPANESE;
}

function own<T>(table: Readonly<Record<string, T>>, key: string): T | null {
  return Object.hasOwn(table, key) ? table[key] : null;
}

/** `assets/rarity/jp/rr.png` for `jp/rr`. */
export function rarityIconUrl(name: RarityIconName): string {
  return `assets/rarity/${name}.png`;
}
