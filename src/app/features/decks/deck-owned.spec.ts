import type { Deck } from '@pokepaper/shared';
import { makeContractCard } from '../../core/data/storage-engine.contract';
import { ownedCoverage } from './deck-owned';
import type { CheckedCard } from './deck-rules';

/** A deck card whose identical printings are `printings` (its own key included). */
function checked(id: string, printings: string[]): CheckedCard {
  return {
    card: makeContractCard('intl', id.split('-')[0] ?? 'set', id, 0),
    serie: 'sv',
    printings,
    legal: { standard: true, expanded: true },
  };
}

function deckOf(slots: [string, number][]): Pick<Deck, 'cards'> {
  return { cards: slots.map(([cardId, count]) => ({ region: 'intl', cardId, count })) };
}

const ball = ['intl:sv01-196', 'intl:sv04-091', 'intl:me01-131'];
const cards = new Map<string, CheckedCard>([
  ['intl:sv01-196', checked('sv01-196', ball)],
  ['intl:sv04-091', checked('sv04-091', ball)],
  ['intl:sv03-125', checked('sv03-125', ['intl:sv03-125'])],
]);

describe('ownedCoverage', () => {
  it('covers a card with copies of its own printing, counting what’s missing', () => {
    const owned = ownedCoverage(deckOf([['sv03-125', 3]]), cards, (key) =>
      key === 'intl:sv03-125' ? 2 : 0
    );

    expect(owned.slots.get('intl:sv03-125')).toEqual({ owned: 2, fromOther: 0, missing: 1 });
    expect(owned.missing).toBe(1);
  });

  it('counts copies of identical printings, saying how many', () => {
    const owned = ownedCoverage(deckOf([['sv01-196', 4]]), cards, (key) =>
      key === 'intl:sv01-196' ? 1 : key === 'intl:me01-131' ? 5 : 0
    );

    expect(owned.slots.get('intl:sv01-196')).toEqual({ owned: 4, fromOther: 3, missing: 0 });
    expect(owned.missing).toBe(0);
  });

  it('shares copies across slots of identical printings, never counting one twice', () => {
    // 3 copies in all (2 + 1) for 4 + 2 needed.
    const owned = ownedCoverage(
      deckOf([
        ['sv01-196', 4],
        ['sv04-091', 2],
      ]),
      cards,
      (key) => (key === 'intl:sv04-091' ? 2 : key === 'intl:me01-131' ? 1 : 0)
    );

    // Each slot takes its own printing first; what's left goes in deck order.
    expect(owned.slots.get('intl:sv04-091')).toEqual({ owned: 2, fromOther: 0, missing: 0 });
    expect(owned.slots.get('intl:sv01-196')).toEqual({ owned: 1, fromOther: 1, missing: 3 });
    expect(owned.missing).toBe(3);
  });

  it('lends one slot’s spare copies of its own printing to another', () => {
    const owned = ownedCoverage(
      deckOf([
        ['sv01-196', 1],
        ['sv04-091', 2],
      ]),
      cards,
      (key) => (key === 'intl:sv01-196' ? 3 : 0)
    );

    expect(owned.slots.get('intl:sv01-196')).toEqual({ owned: 1, fromOther: 0, missing: 0 });
    expect(owned.slots.get('intl:sv04-091')).toEqual({ owned: 2, fromOther: 2, missing: 0 });
  });

  it('leaves out cards not on this device', () => {
    const owned = ownedCoverage(
      deckOf([
        ['gone-1', 4],
        ['sv03-125', 1],
      ]),
      cards,
      () => 0
    );

    expect(owned.slots.has('intl:gone-1')).toBe(false);
    expect(owned.missing).toBe(1);
    expect(owned.unknown).toBe(4);
  });

  it('pools slots whose printings only overlap, so no copy covers two cards', () => {
    // A lists B as identical, but B's own lookup didn't find A.
    const overlapping = new Map<string, CheckedCard>([
      ['intl:a-1', checked('a-1', ['intl:a-1', 'intl:b-1'])],
      ['intl:b-1', checked('b-1', ['intl:b-1'])],
    ]);
    const owned = ownedCoverage(
      deckOf([
        ['a-1', 2],
        ['b-1', 2],
      ]),
      overlapping,
      (key) => (key === 'intl:b-1' ? 2 : 0)
    );

    expect(owned.slots.get('intl:b-1')).toEqual({ owned: 2, fromOther: 0, missing: 0 });
    expect(owned.slots.get('intl:a-1')).toEqual({ owned: 0, fromOther: 0, missing: 2 });
    expect(owned.missing).toBe(2);
  });

  it('copes with a card’s own printing listed anywhere, or not at all', () => {
    const odd = new Map<string, CheckedCard>([
      ['intl:a-1', checked('a-1', ['intl:b-1', 'intl:a-1'])],
      ['intl:c-1', checked('c-1', ['intl:d-1'])],
    ]);
    const owned = ownedCoverage(
      deckOf([
        ['a-1', 1],
        ['c-1', 1],
      ]),
      odd,
      (key) => (key === 'intl:b-1' || key === 'intl:c-1' ? 1 : 0)
    );

    expect(owned.slots.get('intl:a-1')).toEqual({ owned: 1, fromOther: 1, missing: 0 });
    expect(owned.slots.get('intl:c-1')).toEqual({ owned: 1, fromOther: 0, missing: 0 });
  });
});
