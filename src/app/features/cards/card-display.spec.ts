import { catalogSetImageUrl, type CatalogCard } from '@pokepaper/shared';
import { makeContractCard, makeContractPack } from '../../core/data/storage-engine.contract';
import {
  cardSubtitle,
  cardText,
  cardTint,
  formatStage,
  priceRows,
  retreatCost,
  retreatLabel,
  setLine,
  setLogoUrl,
} from './card-display';
import { energyIconUrl } from './energy-icon.component';

const card = (overrides: Partial<CatalogCard>): CatalogCard => ({
  ...makeContractCard('intl', 'sv01', 'sv01-001', 0),
  ...overrides,
});

describe('card display helpers', () => {
  it('formats stages', () => {
    expect(formatStage('Stage1')).toBe('Stage 1');
    expect(formatStage('VMAX')).toBe('VMAX');
    expect(formatStage(null)).toBeNull();
  });

  it('describes Pokémon, Trainers and Energy', () => {
    expect(cardSubtitle(card({ hp: 110, stage: 'Stage1' }))).toBe('HP 110 · Stage 1');
    expect(cardSubtitle(card({ category: 'Trainer', trainerType: 'Item' }))).toBe('Item');
    expect(cardSubtitle(card({ category: 'Energy', energyType: 'Basic' }))).toBe('Basic Energy');
  });

  it('tints by type, except Trainers', () => {
    expect(cardTint(card({ types: ['Fire'] }))).toBe('Fire');
    expect(cardTint(card({ category: 'Trainer', types: [] }))).toBeNull();
  });

  it('falls back to the first language with text', () => {
    expect(cardText(card({}), 'de')?.name).toBe('sv01-001');
  });

  it('builds the set line with the official count', () => {
    const { set } = makeContractPack('intl', 'sv01', []);
    expect(
      setLine(
        { ...set, abbreviation: 'SVI', cardCount: { total: 258, official: 198 } },
        card({ localId: '004' })
      )
    ).toBe('SVI · 004/198');
    expect(
      setLine(
        { ...set, abbreviation: null, cardCount: { total: 3, official: 0 } },
        card({ localId: '1' })
      )
    ).toBe('sv01 · 1');
  });
});

describe('prices', () => {
  const figures = (trend: number | null, avg7: number | null, avg30: number | null) => ({
    trend,
    avg7,
    avg30,
  });
  const prices = (
    base: ReturnType<typeof figures> | null,
    reverseHolo: ReturnType<typeof figures> | null = null
  ) => ({ updated: '2026-11-21T05:47:42.306Z', base, reverseHolo });
  const variants = (overrides: Partial<CatalogCard['variants']>): CatalogCard['variants'] => ({
    normal: false,
    reverse: false,
    holo: false,
    firstEdition: false,
    wPromo: false,
    ...overrides,
  });

  const modern = { releaseDate: '2023-03-31' };

  it('lists the base finish and the reverse holo', () => {
    expect(
      priceRows(
        card({ variants: variants({ normal: true, reverse: true }) }),
        modern,
        prices(figures(0.14, 0.1, 0.08), figures(0.28, null, 0.3)),
        true
      )
    ).toEqual([
      { finish: 'base', label: 'Normal', price: 0.14, avg7: 0.1, avg30: 0.08 },
      { finish: 'reverseHolo', label: 'Reverse holo', price: 0.28, avg7: null, avg30: 0.3 },
    ]);
  });

  it('names the base finish Holo for cards printed only as holo', () => {
    const rows = priceRows(
      card({ variants: variants({ holo: true, reverse: true }) }),
      modern,
      prices(figures(313.78, null, null)),
      true
    );

    expect(rows.map((row) => row.label)).toEqual(['Holo']);
  });

  it('leaves out reverse holo figures for cards that can’t come in one', () => {
    const both = prices(figures(21.11, null, null), figures(6.84, null, null));
    const fatesCollide = { releaseDate: '2016-05-02' };
    const normalOnly = { variants: variants({ normal: true }) };
    const finishes = (
      overrides: Partial<CatalogCard>,
      set: { releaseDate: string | null },
      setFlagsReverseHolos: boolean
    ) => priceRows(card(overrides), set, both, setFlagsReverseHolos).map((row) => row.finish);

    // Fates Collide's full art Kingdra-EX: its set has no reverse holo flags…
    expect(
      finishes({ ...normalOnly, rarity: 'Ultra Rare', suffix: 'EX' }, fatesCollide, false)
    ).toEqual(['base']);
    // …but its commons do come in reverse holo.
    expect(finishes(normalOnly, fatesCollide, false)).toEqual(['base', 'reverseHolo']);
    // An unflagged card in a set whose flags TCGdex keeps.
    expect(finishes(normalOnly, modern, true)).toEqual(['base']);
    // Base Set: before reverse holos, unless TCGdex flags one.
    const baseSet = { releaseDate: '1999-01-09' };
    expect(finishes(normalOnly, baseSet, false)).toEqual(['base']);
    expect(finishes({ variants: variants({ holo: true, reverse: true }) }, baseSet, false)).toEqual(
      ['base', 'reverseHolo']
    );
  });

  it('skips finishes without a headline price, and cards without prices', () => {
    expect(
      priceRows(card({}), modern, prices(figures(null, 2, null), figures(1, 1, 1)), true)
    ).toEqual([{ finish: 'reverseHolo', label: 'Reverse holo', price: 1, avg7: 1, avg30: 1 }]);
    expect(priceRows(card({}), modern, undefined, true)).toEqual([]);
  });
});

describe('set and energy assets', () => {
  it('picks the set logo in the language, else another, else none', () => {
    const { set } = makeContractPack('intl', 'sv01', []);
    const withLogos = {
      ...set,
      serieId: 'sv',
      logos: { en: 'en/sv/sv01/logo', de: 'de/sv/sv01/logo' },
    };

    expect(setLogoUrl(withLogos, 'de')).toBe(
      catalogSetImageUrl(withLogos, { kind: 'logo', language: 'de' })
    );
    expect(setLogoUrl(withLogos, 'fr')).toBe(
      catalogSetImageUrl(withLogos, { kind: 'logo', language: 'en' })
    );
    expect(setLogoUrl({ ...set, logos: {} }, 'en')).toBeNull();
  });

  it('spells out retreat cost as Colorless energy', () => {
    expect(retreatCost(card({ retreat: 2 }))).toEqual(['Colorless', 'Colorless']);
    expect(retreatCost(card({ retreat: 0 }))).toEqual([]);
    expect(retreatCost(card({ retreat: null }))).toEqual([]);
    expect(retreatLabel(card({ retreat: 2 }))).toBe('2 Colorless');
    expect(retreatLabel(card({ retreat: 0 }))).toBeNull();
  });

  it('maps energy types to their icon files', () => {
    expect(energyIconUrl('Psychic')).toBe('assets/energy/psychic.png');
  });
});
