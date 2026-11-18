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
  name: string;
  count: number;
}

const INTERNATIONAL: Readonly<Record<string, string>> = {
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
const JAPANESE: Readonly<Record<string, string>> = {
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
const MEGA_SERIES: Readonly<Record<string, string>> = {
  ...JAPANESE,
  'Mega Hyper Rare': 'jp/mur',
};

/**
 * Asian series from before Black & White: their cards print the
 * international ●◆★ symbols, with every rare as ★.
 */
const SYMBOL_ERA_SERIES = new Set(['PMCG', 'neo', 'VS', 'web', 'e', 'PCG']);

/** TCG Pocket's rarities, the same in every region. */
const POCKET: Readonly<Record<string, RarityIcon>> = {
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
 * null when it has none ("None", or a rarity without a symbol). Without a
 * series (the rarity filter), Asian rarities get their modern letter code.
 */
export function rarityIcon(
  rarity: string | null | undefined,
  region: CatalogRegion,
  seriesId?: string
): RarityIcon | null {
  if (!rarity || rarity === 'None') {
    return null;
  }
  if (Object.hasOwn(POCKET, rarity)) {
    return POCKET[rarity];
  }
  const name = lookup(rarity, region, seriesId);
  return name ? { name, count: 1 } : null;
}

function lookup(
  rarity: string,
  region: CatalogRegion,
  seriesId: string | undefined
): string | null {
  if (region === 'intl') {
    return own(INTERNATIONAL, rarity);
  }
  if (seriesId && SYMBOL_ERA_SERIES.has(seriesId)) {
    return rarity === 'Common' ? 'common' : rarity === 'Uncommon' ? 'uncommon' : 'rare';
  }
  return own(seriesId === 'M' ? MEGA_SERIES : JAPANESE, rarity);
}

function own(table: Readonly<Record<string, string>>, key: string): string | null {
  return Object.hasOwn(table, key) ? table[key] : null;
}

/** `assets/rarity/jp/rr.png` for `jp/rr`. */
export function rarityIconUrl(name: string): string {
  return `assets/rarity/${name}.png`;
}
