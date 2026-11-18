import {
  catalogSetImageUrl,
  COLLECTION_VARIANTS,
  type CatalogCard,
  type CatalogLanguage,
  type CatalogSet,
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

/** The variants a card can be collected in: TCGdex's flags, else just `normal`. */
export function cardVariants(card: CatalogCard): CollectionVariant[] {
  const listed = COLLECTION_VARIANTS.filter((variant) => card.variants[variant]);
  return listed.length > 0 ? listed : ['normal'];
}
