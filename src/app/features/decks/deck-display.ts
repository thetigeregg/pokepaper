import { isDeckFormat, type Deck, type DeckFormat } from '@pokepaper/shared';

/** What each format is called in the app. */
export const DECK_FORMAT_LABELS: Record<DeckFormat, string> = {
  standard: 'Standard',
  expanded: 'Expanded',
  unlimited: 'Unlimited',
};

/** The deck's format, or `unlimited` for one this build doesn't know (docs/decks.md). */
export function deckFormat(deck: Pick<Deck, 'format'>): DeckFormat {
  return isDeckFormat(deck.format) ? deck.format : 'unlimited';
}

/** Every copy in the deck. */
export function deckCardTotal(deck: Pick<Deck, 'cards'>): number {
  return deck.cards.reduce((total, card) => total + card.count, 0);
}

/** "Standard · 47 cards". */
export function deckSummary(deck: Pick<Deck, 'format' | 'cards'>): string {
  const total = deckCardTotal(deck);
  return `${DECK_FORMAT_LABELS[deckFormat(deck)]} · ${String(total)} ${total === 1 ? 'card' : 'cards'}`;
}
