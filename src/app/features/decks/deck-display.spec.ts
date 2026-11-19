import type { Deck } from '@pokepaper/shared';
import { DECK_FORMAT_LABELS, deckCardTotal, deckFormat, deckSummary } from './deck-display';

const deck: Pick<Deck, 'format' | 'cards'> = {
  format: 'expanded',
  cards: [
    { region: 'intl', cardId: 'sv03-125', count: 3 },
    { region: 'intl', cardId: 'sve-002', count: 9 },
  ],
};

describe('deck display', () => {
  it('labels every format', () => {
    expect(Object.values(DECK_FORMAT_LABELS)).toEqual(['Standard', 'Expanded', 'Unlimited']);
  });

  it('treats a format this build does not know as Unlimited', () => {
    expect(deckFormat(deck)).toBe('expanded');
    expect(deckFormat({ format: 'glc' })).toBe('unlimited');
  });

  it('totals the copies', () => {
    expect(deckCardTotal(deck)).toBe(12);
    expect(deckCardTotal({ cards: [] })).toBe(0);
  });

  it('summarizes the format and total, singular for one card', () => {
    expect(deckSummary(deck)).toBe('Expanded · 12 cards');
    expect(
      deckSummary({ format: 'standard', cards: [{ region: 'intl', cardId: 'x', count: 1 }] })
    ).toBe('Standard · 1 card');
    expect(deckSummary({ format: 'standard', cards: [] })).toBe('Standard · 0 cards');
  });
});
