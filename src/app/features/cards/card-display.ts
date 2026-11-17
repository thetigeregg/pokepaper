import type { CatalogCard, CatalogLanguage } from '@pokepaper/shared';

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

/** The energy type that colors a card without a scan, or null for a neutral card. */
export function cardTint(card: CatalogCard): string | null {
  return card.category === 'Trainer' ? null : (card.types[0] ?? null);
}

/** TCGdex's "Stage1" → "Stage 1"; other stages ("Basic", "VMAX") unchanged. */
export function formatStage(stage: string | null): string | null {
  return stage?.replace(/^Stage(\d)$/, 'Stage $1') ?? null;
}
