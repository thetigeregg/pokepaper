import type { CollectionEntry } from '@pokepaper/shared';
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
