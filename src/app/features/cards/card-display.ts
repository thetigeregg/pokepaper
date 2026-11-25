import {
  headlinePrice,
  reverseHoloPossible,
  type ReverseHoloSet,
  type SetReverseHolos,
} from '../../core/utils/catalog-price.util';
import {
  catalogSetImageUrl,
  COLLECTION_VARIANTS,
  isStampedVariant,
  type CatalogCard,
  type CatalogCardPrices,
  type CatalogLanguage,
  type CatalogSet,
  type CatalogStampedPrinting,
  type CollectionTarget,
  type CollectionVariant,
  type StampedVariant,
} from '@pokepaper/shared';

/** The card's text in `language`, else in its first available language. */
export function cardText(card: CatalogCard, language: CatalogLanguage) {
  return card.text[language] ?? Object.values(card.text).at(0);
}

/** "HP 70 · Basic", "Item", "Basic Energy"… */
export function cardSubtitle(card: CatalogCard): string {
  if (card.category === 'Pokemon') {
    return [card.hp !== null ? `HP ${String(card.hp)}` : null, formatStage(card.stage)]
      .filter((part) => part)
      .join(' · ');
  }
  if (card.category === 'Trainer') {
    return card.trainerType ?? 'Trainer';
  }
  return card.energyType ? `${card.energyType} Energy` : 'Energy';
}

/** Retreat cost as Colorless energy, one per point; empty for no cost. */
export function retreatCost(card: CatalogCard): string[] {
  return Array.from({ length: card.retreat ?? 0 }, () => 'Colorless');
}

/** One screen-reader label for the retreat icons ("2 Colorless"); null for no cost. */
export function retreatLabel(card: CatalogCard): string | null {
  const count = retreatCost(card).length;
  return count ? `${String(count)} Colorless` : null;
}

/** The energy type that colors a card without a scan, or null for a neutral card. */
export function cardTint(card: CatalogCard): string | null {
  return card.category === 'Trainer' ? null : (card.types[0] ?? null);
}

/** TCGdex's "Stage1" → "Stage 1"; other stages ("Basic", "VMAX") unchanged. */
export function formatStage(stage: string | null): string | null {
  return stage?.replace(/^Stage(\d)$/, 'Stage $1') ?? null;
}

/** "SVI · 001/198" for a card in its set (bottom line of no-scan cards). */
export function setLine(set: CatalogSet, card: CatalogCard): string {
  const prefix = set.abbreviation ?? set.id;
  const total = set.cardCount.official > 0 ? `/${String(set.cardCount.official)}` : '';
  return `${prefix} · ${card.localId}${total}`;
}

/** The set's logo in `language`, else in another language; null without one. */
export function setLogoUrl(set: CatalogSet, language: CatalogLanguage): string | null {
  const logoLanguage =
    (set.logos[language] ? language : undefined) ??
    (Object.keys(set.logos) as CatalogLanguage[]).at(0);
  return logoLanguage ? catalogSetImageUrl(set, { kind: 'logo', language: logoLanguage }) : null;
}

/** Collection stepper labels for each variant (docs/collection.md). */
export const VARIANT_LABELS: Readonly<Record<CollectionVariant, string>> = {
  normal: 'Normal',
  holo: 'Holo',
  reverse: 'Reverse holo',
  firstEdition: '1st edition',
  wPromo: 'W promo',
};

/** The variants a card can be collected in: TCGdex's flags, else just `normal` (never none). */
export function cardVariants(card: CatalogCard): [CollectionVariant, ...CollectionVariant[]] {
  const listed = COLLECTION_VARIANTS.filter((variant) => card.variants[variant]);
  const [first, ...rest] = listed;
  return listed.length > 0 ? [first, ...rest] : ['normal'];
}

/**
 * Whether `listedVariants` names the card's Normal Holo: TCGplayer sells it
 * as a holo and not as a non-holo (`tcgplayerFinishes`), and TCGdex lists
 * Normal but not Holo.
 */
function namesNormalHolo(card: CatalogCard): boolean {
  const finishes = card.tcgplayerFinishes;
  const listed = cardVariants(card);
  return (
    finishes?.holo === true &&
    !finishes.normal &&
    listed.includes('normal') &&
    !listed.includes('holo')
  );
}

/**
 * TCGdex's variants (`cardVariants`), with Normal named Holo when TCGplayer
 * sells the card as a holo and not as a non-holo (`tcgplayerFinishes`):
 * TCGdex lists many holo rares as normal (BREAKthrough Typhlosion). Both are
 * valued at the Standard price, so only the name changes.
 */
export function listedVariants(card: CatalogCard): CollectionVariant[] {
  const listed = cardVariants(card);
  return namesNormalHolo(card)
    ? COLLECTION_VARIANTS.filter(
        (variant) => variant === 'holo' || (variant !== 'normal' && listed.includes(variant))
      )
    : listed;
}

/**
 * The variants card detail and the set checklist offer: TCGdex's, named as
 * TCGplayer sells them (`listedVariants`), plus reverse holo whenever the card can come in one
 * (`reverseHoloPossible`), as card detail shows its reverse holo price for:
 * TCGdex lacks reverse holo flags for whole sets. `setHolos` is
 * `setReverseHolos` of the card's set.
 */
export function offeredVariants(
  card: CatalogCard,
  set: ReverseHoloSet,
  setHolos: SetReverseHolos
): CollectionVariant[] {
  const listed = listedVariants(card);
  return listed.includes('reverse') || !reverseHoloPossible(card, set, setHolos)
    ? listed
    : COLLECTION_VARIANTS.filter((variant) => variant === 'reverse' || listed.includes(variant));
}

/** What a copy of `card` in `variant` and `language` is counted under. */
export function collectionTarget(
  card: CatalogCard,
  variant: CollectionVariant | StampedVariant,
  language: CatalogLanguage
): CollectionTarget {
  return { region: card.region, cardId: card.id, setId: card.setId, variant, language };
}

/** A variant of a card with the copies owned, for a stepper or a toggle. */
export interface VariantRow {
  /** A plain variant, or a stamped version's (`CatalogStampedPrinting.key`). */
  variant: CollectionVariant | StampedVariant;
  label: string;
  quantity: number;
}

/**
 * The variants to offer for a card with the copies owned of each: those
 * `offered` (`offeredVariants`), plus any other variant owned, so every
 * counted copy can be seen and changed.
 */
export function variantRows(
  offered: readonly CollectionVariant[],
  quantity: (variant: CollectionVariant) => number
): VariantRow[] {
  return COLLECTION_VARIANTS.map((variant) => ({
    variant,
    label: VARIANT_LABELS[variant],
    quantity: quantity(variant),
  })).filter((row) => offered.includes(row.variant) || row.quantity > 0);
}

/**
 * Stamp names TCGdex gives (`pre-release`…) that don't read right as plain
 * words; any other is shown word by word, capitalized (`set-logo` → "Set
 * Logo", `worlds-2010` → "Worlds 2010").
 */
const STAMP_LABELS: Readonly<Record<string, string>> = {
  '1st-edition': '1st Edition',
  'pre-release': 'Prerelease',
  'pokemon-center': 'Pokémon Center',
  'pokemon-day': 'Pokémon Day',
  'poke-ball-league': 'Poké Ball League',
  pokeball: 'Poké Ball',
  mcdonalds: "McDonald's",
  'eb-games': 'EB Games',
  gamestop: 'GameStop',
  'toys-r-us': 'Toys "R" Us',
  'comic-con': 'Comic-Con',
  'build-a-bear': 'Build-A-Bear',
  wotc: 'WotC',
  'top-thirty-two': 'Top 32',
  'top-sixteen': 'Top 16',
  'top-eight': 'Top 8',
  'semi-finalist': 'Semifinalist',
  'quarter-finalist': 'Quarterfinalist',
};

/** How a TCGdex name (a stamp, subtype or foil) reads: `STAMP_LABELS`, else capitalized words. */
export function stampLabel(name: string): string {
  const known = Object.hasOwn(STAMP_LABELS, name) ? STAMP_LABELS[name] : undefined;
  return (
    known ??
    name
      .split('-')
      .filter((word) => word)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  );
}

/**
 * A stamped version's stepper label: its finish, then its stamps, subtype
 * and foil ("Holo · Prerelease"). The finish is named like the card's plain
 * variants: Normal is Holo where `listedVariants` names the card's Normal
 * Holo.
 */
export function stampedLabel(card: CatalogCard, printing: CatalogStampedPrinting): string {
  const finish = printing.type === 'normal' && namesNormalHolo(card) ? 'holo' : printing.type;
  return [
    VARIANT_LABELS[finish],
    ...[...printing.stamps, printing.subtype, printing.foil]
      .filter((name) => name !== undefined)
      .map(stampLabel),
  ].join(' · ');
}

/** The label of copies counted under a stamped version the catalog no longer lists. */
export const UNLISTED_STAMPED_LABEL = 'Stamped version no longer listed';

/**
 * Rows for a card's stamped versions (`CatalogStampedPrinting`), after its
 * plain variants (`variantRows`): every one the catalog lists when
 * `offerAll`, else only those owned; then copies counted under a stamped
 * version it no longer lists, so every counted copy can be seen and
 * changed. `owned` holds the variants owned of the card (in the language
 * shown).
 */
export function stampedRows(
  card: CatalogCard,
  owned: readonly string[],
  quantity: (variant: StampedVariant) => number,
  offerAll: boolean
): VariantRow[] {
  const printings = (card.stamped ?? []).flatMap((printing) => {
    const { key } = printing;
    return isStampedVariant(key) ? [{ key, printing }] : [];
  });
  const listed = new Set<string>(printings.map(({ key }) => key));
  const unlisted = owned
    .filter((variant): variant is StampedVariant => isStampedVariant(variant))
    .filter((variant) => !listed.has(variant))
    .sort();
  return [
    ...printings
      .filter(({ key }) => offerAll || owned.includes(key))
      .map(({ key, printing }) => ({
        variant: key,
        label: stampedLabel(card, printing),
        quantity: quantity(key),
      })),
    ...unlisted.map((variant) => ({
      variant,
      label: UNLISTED_STAMPED_LABEL,
      quantity: quantity(variant),
    })),
  ];
}

/** One finish's prices in card detail's Price section. */
export interface PriceRow {
  finish: 'base' | 'reverseHolo';
  label: string;
  /** What the row covers, under its label; null when it needs no saying. */
  hint: string | null;
  price: number;
  avg7: number | null;
  avg30: number | null;
}

/**
 * Card detail's Price rows: the base finish and the reverse holo, each when
 * it has a headline price. The base finish is named Standard, not after a
 * printing: it's every copy not sold as reverse holo, whatever the card's
 * finish, and TCGdex's flags name some cards' printings wrongly. With a
 * reverse holo row beside it, a hint says what it covers. Cardmarket reports
 * reverse holo figures for many cards never printed as one (sales tagged
 * reverse holo by sellers), so the reverse holo is left out unless the
 * card can come in one (`reverseHoloPossible`). `setHolos` is
 * `setReverseHolos` of the card's set.
 */
export function priceRows(
  card: CatalogCard,
  set: ReverseHoloSet,
  prices: CatalogCardPrices | undefined,
  setHolos: SetReverseHolos
): PriceRow[] {
  if (!prices) {
    return [];
  }
  const reverseHolo = reverseHoloPossible(card, set, setHolos);
  const finishes = [
    { finish: 'base', label: 'Standard', figures: prices.base },
    {
      finish: 'reverseHolo',
      label: VARIANT_LABELS.reverse,
      figures: reverseHolo ? prices.reverseHolo : null,
    },
  ] as const;
  const rows = finishes.flatMap(({ finish, label, figures }) => {
    const price = figures ? headlinePrice(figures) : null;
    return figures && price !== null
      ? [{ finish, label, hint: null, price, avg7: figures.avg7, avg30: figures.avg30 }]
      : [];
  });
  return rows.length > 1
    ? rows.map((row) =>
        row.finish === 'base' ? { ...row, hint: 'Every copy not sold as reverse holo' } : row
      )
    : rows;
}
