import { catalogSetImageUrl, type CatalogCard } from '@pokepaper/shared';
import { makeContractCard, makeContractPack } from '../../core/data/storage-engine.contract';
import {
  cardSubtitle,
  cardText,
  cardTint,
  formatStage,
  listedVariants,
  offeredVariants,
  priceRows,
  retreatCost,
  retreatLabel,
  setLine,
  setLogoUrl,
  variantRows,
} from './card-display';
import { energyIconUrl } from './energy-icon.component';
import type { SetReverseHolos } from '../../core/utils/catalog-price.util';

/** A set whose reverse holo flags TCGdex keeps. */
const KEEPS: SetReverseHolos = { tcgdexFlags: true, tcgplayerSells: false };
/** A set without flags where TCGplayer sells reverse holos. */
const FLAGLESS: SetReverseHolos = { tcgdexFlags: false, tcgplayerSells: true };

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

  const modern = { releaseDate: '2023-03-31', names: { en: 'Set' } };

  it('lists the base finish and the reverse holo', () => {
    expect(
      priceRows(
        card({ variants: variants({ normal: true, reverse: true }) }),
        modern,
        prices(figures(0.14, 0.1, 0.08), figures(0.28, null, 0.3)),
        KEEPS
      )
    ).toEqual([
      {
        finish: 'base',
        label: 'Standard',
        hint: 'Every copy not sold as reverse holo',
        price: 0.14,
        avg7: 0.1,
        avg30: 0.08,
      },
      {
        finish: 'reverseHolo',
        label: 'Reverse holo',
        hint: null,
        price: 0.28,
        avg7: null,
        avg30: 0.3,
      },
    ]);
  });

  it('names the base finish Standard whatever TCGdex flags, without a hint when alone', () => {
    for (const flags of [{ holo: true }, { normal: true }, { reverse: true }, {}]) {
      const rows = priceRows(
        card({ variants: variants(flags) }),
        { releaseDate: '1999-07-01', names: { en: 'Set' } },
        prices(figures(55.87, null, null), figures(12.61, null, null)),
        FLAGLESS
      );

      expect(rows.map(({ label, hint }) => ({ label, hint }))).toEqual([
        { label: 'Standard', hint: null },
      ]);
    }
  });

  it('leaves out reverse holo figures for cards that can’t come in one', () => {
    const both = prices(figures(21.11, null, null), figures(6.84, null, null));
    const fatesCollide = { releaseDate: '2016-05-02', names: { en: 'Set' } };
    const normalOnly = { variants: variants({ normal: true }) };
    const finishes = (
      overrides: Partial<CatalogCard>,
      set: { releaseDate: string | null; names: { en: string } },
      setHolos: SetReverseHolos
    ) => priceRows(card(overrides), set, both, setHolos).map((row) => row.finish);

    // Fates Collide's full art Kingdra-EX: its set has no reverse holo flags…
    expect(
      finishes({ ...normalOnly, rarity: 'Ultra Rare', suffix: 'EX' }, fatesCollide, FLAGLESS)
    ).toEqual(['base']);
    // …but its commons do come in reverse holo.
    expect(finishes(normalOnly, fatesCollide, FLAGLESS)).toEqual(['base', 'reverseHolo']);
    // An unflagged card in a set whose flags TCGdex keeps.
    expect(finishes(normalOnly, modern, KEEPS)).toEqual(['base']);
    // Base Set: before reverse holos, even when TCGdex flags one.
    const baseSet = { releaseDate: '1999-01-09', names: { en: 'Set' } };
    expect(finishes(normalOnly, baseSet, FLAGLESS)).toEqual(['base']);
    expect(
      finishes({ variants: variants({ holo: true, reverse: true }) }, baseSet, FLAGLESS)
    ).toEqual(['base']);
  });

  it('skips finishes without a headline price, and cards without prices', () => {
    expect(
      priceRows(card({}), modern, prices(figures(null, 2, null), figures(1, 1, 1)), KEEPS)
    ).toEqual([
      { finish: 'reverseHolo', label: 'Reverse holo', hint: null, price: 1, avg7: 1, avg30: 1 },
    ]);
    expect(priceRows(card({}), modern, undefined, KEEPS)).toEqual([]);
  });
});

describe('variants offered', () => {
  const variants = (overrides: Partial<CatalogCard['variants']>): CatalogCard['variants'] => ({
    normal: false,
    reverse: false,
    holo: false,
    firstEdition: false,
    wPromo: false,
    ...overrides,
  });
  const breakthrough = { releaseDate: '2015-11-04', names: { en: 'BREAKthrough' } };

  it('adds reverse holo when the card can come in one, though TCGdex doesn’t flag it', () => {
    // BREAKthrough Typhlosion: TCGplayer sells it in holo and reverse holo.
    const typhlosion = card({
      rarity: 'Rare',
      variants: variants({ normal: true }),
      tcgplayerFinishes: { normal: false, holo: true, reverse: true, firstEdition: false },
    });
    expect(offeredVariants(typhlosion, breakthrough, FLAGLESS)).toEqual(['holo', 'reverse']);
    // A card listed in holo and 1st edition keeps their order around reverse holo.
    expect(
      offeredVariants(
        card({ rarity: 'Rare', variants: variants({ holo: true, firstEdition: true }) }),
        { releaseDate: '2003-06-18', names: { en: 'Sandstorm' } },
        FLAGLESS
      )
    ).toEqual(['holo', 'reverse', 'firstEdition']);
  });

  it('offers only TCGdex’s variants when the card can’t come in reverse holo', () => {
    const flareon = card({
      rarity: 'Rare',
      variants: variants({ normal: true, holo: true }),
      tcgplayerFinishes: { normal: true, holo: true, reverse: false, firstEdition: false },
    });
    expect(
      offeredVariants(
        flareon,
        { releaseDate: '2006-04-01', names: { en: 'POP Series 3' } },
        { tcgdexFlags: false, tcgplayerSells: false }
      )
    ).toEqual(['normal', 'holo']);
    // Unflagged in a set whose flags TCGdex keeps.
    expect(
      offeredVariants(card({ variants: variants({ normal: true }) }), breakthrough, KEEPS)
    ).toEqual(['normal']);
    // Wizards promo 34 Entei keeps the reverse holo TCGdex lists.
    expect(
      offeredVariants(
        card({ variants: variants({ reverse: true }) }),
        { releaseDate: '1999-07-01', names: { en: 'Wizards Black Star Promos' } },
        FLAGLESS
      )
    ).toEqual(['reverse']);
  });

  it('names Normal Holo when TCGplayer sells the card only as a holo', () => {
    const finishes = (holo: boolean, normal: boolean) => ({
      normal,
      holo,
      reverse: true,
      firstEdition: false,
    });
    // BREAKthrough Typhlosion: TCGdex lists normal; TCGplayer sells holo and reverse holo.
    expect(
      listedVariants(
        card({ variants: variants({ normal: true }), tcgplayerFinishes: finishes(true, false) })
      )
    ).toEqual(['holo']);
    // No flags at all: just Normal, named Holo the same way.
    expect(
      listedVariants(card({ variants: variants({}), tcgplayerFinishes: finishes(true, false) }))
    ).toEqual(['holo']);
    // Reverse and 1st edition stay as listed.
    expect(
      listedVariants(
        card({
          variants: variants({ normal: true, reverse: true, firstEdition: true }),
          tcgplayerFinishes: finishes(true, false),
        })
      )
    ).toEqual(['holo', 'reverse', 'firstEdition']);
  });

  it('keeps Normal when TCGplayer also sells a non-holo, lists no holo, or nothing', () => {
    const normalOnly = variants({ normal: true });
    const listed = (tcgplayerFinishes?: CatalogCard['tcgplayerFinishes']) =>
      listedVariants(
        card({ variants: normalOnly, ...(tcgplayerFinishes && { tcgplayerFinishes }) })
      );
    // POP Series 3 Flareon: TCGplayer sells it as both.
    expect(listed({ normal: true, holo: true, reverse: false, firstEdition: false })).toEqual([
      'normal',
    ]);
    expect(listed({ normal: true, holo: false, reverse: true, firstEdition: false })).toEqual([
      'normal',
    ]);
    expect(listed()).toEqual(['normal']);
    // TCGdex already lists Holo beside Normal: left as it is.
    expect(
      listedVariants(
        card({
          variants: variants({ normal: true, holo: true }),
          tcgplayerFinishes: { normal: false, holo: true, reverse: false, firstEdition: false },
        })
      )
    ).toEqual(['normal', 'holo']);
  });

  it('lists the offered variants and any other owned, with their copies', () => {
    const owned: Partial<Record<string, number>> = { holo: 2 };
    expect(variantRows(['normal', 'reverse'], (variant) => owned[variant] ?? 0)).toEqual([
      { variant: 'normal', label: 'Normal', quantity: 0 },
      { variant: 'holo', label: 'Holo', quantity: 2 },
      { variant: 'reverse', label: 'Reverse holo', quantity: 0 },
    ]);
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
