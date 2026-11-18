import { catalogSetImageUrl, type CatalogCard } from '@pokepaper/shared';
import { makeContractCard, makeContractPack } from '../../core/data/storage-engine.contract';
import { cardSubtitle, cardText, cardTint, formatStage, setLine, setLogoUrl } from './card-display';
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

  it('maps energy types to their icon files', () => {
    expect(energyIconUrl('Psychic')).toBe('assets/energy/psychic.png');
  });
});
