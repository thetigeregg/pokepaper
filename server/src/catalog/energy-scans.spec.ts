import type { CatalogCard, CatalogCardText } from '@pokepaper/shared';
import { applyEnergyScans, planEnergyScans, type EnergyCard } from './energy-scans.js';

function text(name: string, image: string | null, imageFrom?: string): CatalogCardText {
  return {
    name,
    description: null,
    effect: null,
    evolveFrom: null,
    attacks: [],
    abilities: [],
    image,
    ...(imageFrom ? { imageFrom } : {}),
  };
}

function energy(
  id: string,
  releaseDate: string | null,
  texts: CatalogCard['text'],
  category = 'Energy'
): EnergyCard {
  const card = {
    region: 'intl',
    id,
    setId: id.split('-')[0] ?? 'set',
    localId: '1',
    sortIndex: 0,
    category,
    rarity: 'Common',
    energyType: 'Normal',
    text: texts,
  } as unknown as CatalogCard;
  return { card, releaseDate };
}

describe('planEnergyScans', () => {
  it('borrows the newest scan of the same type, in the same language', () => {
    const changes = planEnergyScans([
      energy('old-1', '2020-01-01', { en: text('Fire Energy', 'en/a/old/1') }),
      energy('new-1', '2024-01-01', {
        en: text('Basic Fire Energy', 'en/b/new/1'),
        de: text('Basis-Feuer-Energie', 'de/b/new/1'),
      }),
      energy('mee-2', '2026-01-01', {
        en: text('Fire Energy', null),
        de: text('Feuer-Energie', null),
        fr: text('Énergie Feu', null),
      }),
      energy('mee-8', '2026-01-01', { en: text('Metal Energy', null) }),
    ]);

    expect(changes).toEqual([
      { setId: 'mee', cardId: 'mee-2', language: 'en', image: 'en/b/new/1', imageFrom: 'new-1' },
      { setId: 'mee', cardId: 'mee-2', language: 'de', image: 'de/b/new/1', imageFrom: 'new-1' },
    ]);
  });

  it('borrows only regular printings, the plainest rarity first, never gold or full-art ones', () => {
    const gold = energy('gold-1', '2026-06-01', { en: text('Basic Fire Energy', 'en/gold') });
    gold.card.rarity = 'Hyper rare';
    const uncommon = energy('unc-1', '2025-01-01', { en: text('Fire Energy', 'en/unc') });
    uncommon.card.rarity = 'Uncommon';
    const common = energy('com-1', '2020-01-01', { en: text('Fire Energy', 'en/com') });
    const needy = energy('mee-2', '2026-09-01', { en: text('Fire Energy', null) });

    expect(planEnergyScans([gold, uncommon, common, needy])).toEqual([
      { setId: 'mee', cardId: 'mee-2', language: 'en', image: 'en/com', imageFrom: 'com-1' },
    ]);
    expect(planEnergyScans([gold, uncommon, needy])[0]?.imageFrom).toBe('unc-1');
    expect(planEnergyScans([gold, needy])).toEqual([]);
  });

  it('breaks release-date ties by card ID, and treats unknown dates as oldest', () => {
    const changes = planEnergyScans([
      energy('b-1', '2024-01-01', { en: text('Water Energy', 'en/b') }),
      energy('a-1', '2024-01-01', { en: text('Water Energy', 'en/a') }),
      energy('z-1', null, { en: text('Water Energy', 'en/z') }),
      energy('x-1', '2026-01-01', { en: text('Water Energy', null) }),
    ]);

    expect(changes).toEqual([
      { setId: 'x', cardId: 'x-1', language: 'en', image: 'en/a', imageFrom: 'a-1' },
    ]);
  });

  it('never borrows from a borrowed scan, and leaves own scans and current borrows alone', () => {
    const changes = planEnergyScans([
      energy('own-1', '2024-01-01', { en: text('Grass Energy', 'en/own') }),
      energy('borrowed-1', '2025-01-01', { en: text('Grass Energy', 'en/own', 'own-1') }),
      energy('other-1', '2026-01-01', { en: text('Grass Energy', null) }),
    ]);

    expect(changes).toEqual([
      { setId: 'other', cardId: 'other-1', language: 'en', image: 'en/own', imageFrom: 'own-1' },
    ]);
  });

  it('moves a borrow to a newer source, and drops one whose source is gone', () => {
    const changes = planEnergyScans([
      energy('newer-1', '2025-01-01', { en: text('Psychic Energy', 'en/newer') }),
      energy('stale-1', '2026-01-01', { en: text('Psychic Energy', 'en/older', 'older-1') }),
      energy('orphan-1', '2026-01-01', { fr: text('Énergie Psy', 'fr/gone', 'gone-1') }),
    ]);

    expect(changes).toEqual([
      {
        setId: 'stale',
        cardId: 'stale-1',
        language: 'en',
        image: 'en/newer',
        imageFrom: 'newer-1',
      },
    ]);
    // Without English text the type is unknown: left alone.
    expect(
      planEnergyScans([
        energy('orphan-2', '2026-01-01', { en: text('Psychic Energy', 'en/gone', 'gone-1') }),
      ])
    ).toEqual([
      { setId: 'orphan', cardId: 'orphan-2', language: 'en', image: null, imageFrom: null },
    ]);
  });

  it('only touches basic Energy, recognized by name', () => {
    expect(
      planEnergyScans([
        energy('s-1', '2024-01-01', { en: text('Fire Energy', 'en/s') }),
        energy('p-1', '2026-01-01', { en: text('Prism Energy', null) }),
        energy('t-1', '2026-01-01', { en: text('Fire Energy', null) }, 'Trainer'),
      ])
    ).toEqual([]);
  });
});

describe('applyEnergyScans', () => {
  it('sets or drops borrowed scans in place, skipping cards not in the set', () => {
    const cards = [
      energy('mee-2', null, { en: text('Fire Energy', null) }).card,
      energy('mee-3', null, { en: text('Water Energy', 'en/x', 'x-1') }).card,
    ];

    const applied = applyEnergyScans(cards, [
      { setId: 'mee', cardId: 'mee-2', language: 'en', image: 'en/new', imageFrom: 'new-1' },
      { setId: 'mee', cardId: 'mee-3', language: 'en', image: null, imageFrom: null },
      { setId: 'mee', cardId: 'mee-9', language: 'en', image: 'en/new', imageFrom: 'new-1' },
      { setId: 'mee', cardId: 'mee-2', language: 'de', image: 'de/new', imageFrom: 'new-1' },
    ]);

    expect(applied).toBe(2);
    expect(cards[0]?.text.en).toMatchObject({ image: 'en/new', imageFrom: 'new-1' });
    expect(cards[1]?.text.en?.image).toBeNull();
    expect(cards[1]?.text.en).not.toHaveProperty('imageFrom');
  });
});
