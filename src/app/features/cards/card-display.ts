import {
  catalogSetImageUrl,
  COLLECTION_VARIANTS,
  type CardmarketFigures,
  type CatalogCard,
  type CatalogCardPrices,
  type CatalogLanguage,
  type CatalogSet,
  type CollectionTarget,
  type CollectionVariant,
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
  reverse: 'Reverse holo',
  holo: 'Holo',
  firstEdition: '1st edition',
  wPromo: 'W promo',
};

/** The variants a card can be collected in: TCGdex's flags, else just `normal` (never none). */
export function cardVariants(card: CatalogCard): [CollectionVariant, ...CollectionVariant[]] {
  const listed = COLLECTION_VARIANTS.filter((variant) => card.variants[variant]);
  const [first, ...rest] = listed;
  return listed.length > 0 ? [first, ...rest] : ['normal'];
}

/** What a copy of `card` in `variant` and `language` is counted under. */
export function collectionTarget(
  card: CatalogCard,
  variant: CollectionVariant,
  language: CatalogLanguage
): CollectionTarget {
  return { region: card.region, cardId: card.id, setId: card.setId, variant, language };
}

/** A variant of a card with the copies owned, for a stepper or a toggle. */
export interface VariantRow {
  variant: CollectionVariant;
  label: string;
  quantity: number;
}

/**
 * The variants to offer for a card with the copies owned of each: those it
 * comes in (`cardVariants`), plus any other variant owned (TCGdex's flags
 * have gaps), so every counted copy can be seen and changed.
 */
export function variantRows(
  card: CatalogCard,
  quantity: (variant: CollectionVariant) => number
): VariantRow[] {
  const listed = cardVariants(card);
  return COLLECTION_VARIANTS.map((variant) => ({
    variant,
    label: VARIANT_LABELS[variant],
    quantity: quantity(variant),
  })).filter((row) => listed.includes(row.variant) || row.quantity > 0);
}

/**
 * The price shown for a finish (docs/catalog.md → Prices): Cardmarket's
 * trend, else the 30-day average; null when it has neither.
 */
export function headlinePrice(figures: CardmarketFigures): number | null {
  return figures.trend ?? figures.avg30;
}

/** One finish's prices in card detail's Price section. */
export interface PriceRow {
  finish: 'base' | 'reverseHolo';
  label: string;
  price: number;
  avg7: number | null;
  avg30: number | null;
}

/**
 * Card detail's Price rows: the base finish (named Holo for cards printed
 * only as holo, which Cardmarket prices as the base product) and the
 * reverse holo, each when it has a headline price.
 */
export function priceRows(card: CatalogCard, prices: CatalogCardPrices | undefined): PriceRow[] {
  if (!prices) {
    return [];
  }
  const variants = cardVariants(card);
  const baseLabel =
    !variants.includes('normal') && variants.includes('holo')
      ? VARIANT_LABELS.holo
      : VARIANT_LABELS.normal;
  const finishes = [
    { finish: 'base', label: baseLabel, figures: prices.base },
    { finish: 'reverseHolo', label: VARIANT_LABELS.reverse, figures: prices.reverseHolo },
  ] as const;
  return finishes.flatMap(({ finish, label, figures }) => {
    const price = figures ? headlinePrice(figures) : null;
    return figures && price !== null
      ? [{ finish, label, price, avg7: figures.avg7, avg30: figures.avg30 }]
      : [];
  });
}
