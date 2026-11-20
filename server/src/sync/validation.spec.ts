import type { CollectionEntry, Deck } from '@pokepaper/shared';
import { settingsOp } from '../test-helpers.js';
import { validateOperation, type RawOperation } from './validation.js';

const entry: CollectionEntry = {
  region: 'intl',
  cardId: 'sv01-001',
  setId: 'sv01',
  variant: 'holo',
  language: 'de',
  quantity: 3,
};

function collectionOp(overrides: Partial<RawOperation> = {}): RawOperation {
  return {
    ...settingsOp(),
    entityType: 'collectionEntry',
    entityId: 'intl:sv01-001:holo:de',
    payload: entry,
    ...overrides,
  };
}

function message(raw: RawOperation): string | undefined {
  const result = validateOperation(raw);
  return result.ok ? undefined : result.rejection.message;
}

describe('validateOperation: collectionEntry', () => {
  it('accepts an upsert whose entity ID matches its payload', () => {
    expect(validateOperation(collectionOp())).toMatchObject({
      ok: true,
      op: { entityType: 'collectionEntry', payload: entry },
    });
  });

  it('accepts a delete by entity ID alone, dropping any payload', () => {
    expect(
      validateOperation(collectionOp({ operation: 'delete', payload: { stray: true } }))
    ).toMatchObject({ ok: true, op: { operation: 'delete', payload: null } });
  });

  it('rejects an upsert whose entity ID names another entry', () => {
    expect(message(collectionOp({ entityId: 'intl:sv01-001:holo:en' }))).toBe(
      'Invalid collectionEntry payload'
    );
  });

  it('rejects an invalid payload', () => {
    expect(message(collectionOp({ payload: { ...entry, quantity: 0 } }))).toBe(
      'Invalid collectionEntry payload'
    );
  });

  it.each([['intl:sv01-001:de'], ['intl::holo:de'], ['settings']])(
    'rejects the malformed entity ID %s, for deletes too',
    (entityId) => {
      expect(message(collectionOp({ entityId, operation: 'delete', payload: null }))).toBe(
        `Invalid entityId "${entityId}" for collectionEntry`
      );
    }
  );
});

const deck: Deck = {
  id: '6f1c2c1e-6c1b-4a8e-9a65-0d3b8f7c2e11',
  name: 'Charizard ex',
  format: 'standard',
  cards: [{ region: 'intl', cardId: 'sv03-125', count: 3 }],
  createdAt: '2026-11-19T10:00:00.000Z',
  updatedAt: '2026-11-19T10:05:00.000Z',
};

function deckOp(overrides: Partial<RawOperation> = {}): RawOperation {
  return {
    ...settingsOp(),
    entityType: 'deck',
    entityId: deck.id,
    payload: deck,
    ...overrides,
  };
}

describe('validateOperation: deck', () => {
  it('accepts an upsert whose entity ID is the deck ID', () => {
    expect(validateOperation(deckOp())).toMatchObject({
      ok: true,
      op: { entityType: 'deck', entityId: deck.id, payload: deck },
    });
  });

  it('accepts a delete by entity ID alone, dropping any payload', () => {
    expect(
      validateOperation(deckOp({ operation: 'delete', payload: { stray: true } }))
    ).toMatchObject({ ok: true, op: { operation: 'delete', payload: null } });
  });

  it('rejects an upsert whose entity ID names another deck', () => {
    expect(message(deckOp({ entityId: 'another-deck' }))).toBe('Invalid deck payload');
  });

  it('rejects an invalid payload', () => {
    expect(message(deckOp({ payload: { ...deck, cards: [{ ...deck.cards[0], count: 0 }] } }))).toBe(
      'Invalid deck payload'
    );
  });

  it('accepts a Considering pile, and rejects an invalid one', () => {
    const considering = [{ region: 'intl', cardId: 'sv03-125', count: 1 }];
    expect(validateOperation(deckOp({ payload: { ...deck, considering } }))).toMatchObject({
      ok: true,
      op: { payload: { considering } },
    });
    expect(
      message(deckOp({ payload: { ...deck, considering: [...considering, ...considering] } }))
    ).toBe('Invalid deck payload');
  });

  it('rejects an entity ID with a colon, for deletes too', () => {
    expect(message(deckOp({ entityId: 'a:b', operation: 'delete', payload: null }))).toBe(
      'Invalid entityId "a:b" for deck'
    );
  });
});
