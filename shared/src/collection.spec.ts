import {
  collectionEntry,
  collectionEntryId,
  COLLECTION_VARIANTS,
  isCollectionEntry,
  isCollectionEntryId,
  isCollectionQuantity,
  isCollectionTarget,
  isCollectionVariant,
  isStampedVariant,
  MAX_COLLECTION_QUANTITY,
  stampedVariant,
  type CollectionEntry,
} from './index';

const entry: CollectionEntry = {
  region: 'intl',
  cardId: 'sv01-001',
  setId: 'sv01',
  variant: 'reverse',
  language: 'de',
  quantity: 2,
};

describe('collectionEntryId', () => {
  it('joins region, card, variant and language', () => {
    expect(collectionEntryId(entry)).toBe('intl:sv01-001:reverse:de');
  });
});

describe('isCollectionEntryId', () => {
  it('accepts the IDs collectionEntryId produces', () => {
    expect(isCollectionEntryId(collectionEntryId(entry))).toBe(true);
    expect(isCollectionEntryId('asia:SV2a-001:holo:zh-tw')).toBe(true);
  });

  it('accepts a card ID containing a colon (the outer parts never do)', () => {
    expect(isCollectionEntryId('intl:odd:id:normal:en')).toBe(true);
  });

  it.each([
    ['too few parts', 'intl:sv01-001:en'],
    ['an empty part', 'intl::normal:en'],
    ['an oversized tag', `intl:sv01-001:${'x'.repeat(17)}:en`],
    ['an oversized card ID', `intl:${'x'.repeat(65)}:normal:en`],
  ])('rejects %s', (_label, value) => {
    expect(isCollectionEntryId(value)).toBe(false);
  });
});

describe('isCollectionEntry', () => {
  it('accepts a valid entry, at both quantity bounds', () => {
    expect(isCollectionEntry(entry)).toBe(true);
    expect(isCollectionEntry({ ...entry, quantity: 1 })).toBe(true);
    expect(isCollectionEntry({ ...entry, quantity: MAX_COLLECTION_QUANTITY })).toBe(true);
  });

  it('accepts variants and languages from newer clients, which this build ignores', () => {
    expect(isCollectionEntry({ ...entry, variant: 'stamped', language: 'ko' })).toBe(true);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a zero quantity', { ...entry, quantity: 0 }],
    ['a fractional quantity', { ...entry, quantity: 1.5 }],
    ['an oversized quantity', { ...entry, quantity: MAX_COLLECTION_QUANTITY + 1 }],
    ['a string quantity', { ...entry, quantity: '2' }],
    ['a missing set', { ...entry, setId: undefined }],
    ['an empty card ID', { ...entry, cardId: '' }],
    ['an oversized card ID', { ...entry, cardId: 'x'.repeat(65) }],
    ['a colon in the language', { ...entry, language: 'd:e' }],
    ['an oversized region', { ...entry, region: 'x'.repeat(17) }],
    ['a non-string variant', { ...entry, variant: 1 }],
  ])('rejects %s', (_label, value) => {
    expect(isCollectionEntry(value)).toBe(false);
  });
});

describe('isCollectionVariant', () => {
  it('accepts every offered variant and rejects anything else', () => {
    for (const variant of COLLECTION_VARIANTS) {
      expect(isCollectionVariant(variant)).toBe(true);
    }
    expect(isCollectionVariant('stamped')).toBe(false);
    expect(isCollectionVariant(undefined)).toBe(false);
  });
});

describe('stampedVariant', () => {
  // TCGdex variantIds of real stamped versions: these keys are stored with
  // tracked copies, so they must never change.
  it.each([
    ['3a83wf50typ2p5qsrlm6y3f8o', 'vp2p5qsrlm6y3f8o'],
    ['1jz5lzkp5fm97k7tuu0kr67dblurfi', 'vtuu0kr67dblurfi'],
    ['555jb0efopmyclvkikic41', 'vfopmyclvkikic41'],
  ])('keys %s as %s', (variantId, key) => {
    expect(stampedVariant(variantId)).toBe(key);
  });

  it('keeps a short variantId whole', () => {
    expect(stampedVariant('jr7oetx1mqug9')).toBe('vjr7oetx1mqug9');
  });

  it('makes valid collection entry variants', () => {
    const variant = stampedVariant('mtltux8qtgdu4exu903oasum21juxbvx6lx');
    expect(isStampedVariant(variant)).toBe(true);
    expect(isCollectionTarget({ ...entry, variant })).toBe(true);
  });
});

describe('isStampedVariant', () => {
  it.each(['vjr7oetx1mqug9', 'v0'])('accepts %s', (value) => {
    expect(isStampedVariant(value)).toBe(true);
  });

  it.each([...COLLECTION_VARIANTS, 'v', 'v0123456789abcdef', 'vABC', 'x123', 1])(
    'rejects %s',
    (value) => {
      expect(isStampedVariant(value)).toBe(false);
    }
  );
});

describe('collectionEntry', () => {
  it('copies only the entry fields', () => {
    const { quantity: _quantity, ...fields } = entry;
    expect(collectionEntry({ ...fields, name: 'Pineco' } as typeof fields, 5)).toEqual({
      ...entry,
      quantity: 5,
    });
  });
});

describe('isCollectionQuantity', () => {
  it('accepts whole numbers from 0 to the maximum', () => {
    expect([0, 1, MAX_COLLECTION_QUANTITY].map(isCollectionQuantity)).toEqual([true, true, true]);
    expect(
      [-1, 1.5, MAX_COLLECTION_QUANTITY + 1, Number.NaN, '1'].map(isCollectionQuantity)
    ).toEqual([false, false, false, false, false]);
  });
});

describe('isCollectionTarget', () => {
  it('checks the entry fields, ignoring the quantity', () => {
    const { quantity: _quantity, ...fields } = entry;
    expect(isCollectionTarget(fields)).toBe(true);
    expect(isCollectionTarget({ ...fields, variant: 'a:b' })).toBe(false);
    expect(isCollectionTarget(null)).toBe(false);
  });
});
