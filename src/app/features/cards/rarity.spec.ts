import { rarityIcon, rarityIconUrl } from './rarity';

describe('rarityIcon', () => {
  const name = (...args: Parameters<typeof rarityIcon>) => rarityIcon(...args)?.name ?? null;

  it('maps international rarities to their symbols', () => {
    expect(name('Common', 'intl')).toBe('common');
    expect(name('Double rare', 'intl')).toBe('double-rare');
    expect(name('Special illustration rare', 'intl')).toBe('special-illustration-rare');
    expect(name('Amazing Rare', 'intl')).toBe('amazing-rare');
    expect(name('Pikachu Rare', 'intl')).toBe('pikachu-rare');
  });

  it('gives holo, secret and full-art trainer rares the plain rare star', () => {
    for (const rarity of ['Holo Rare', 'Holo Rare VMAX', 'Secret Rare', 'Full Art Trainer']) {
      expect(name(rarity, 'intl')).toBe('rare');
    }
  });

  it('maps Asian rarities to Japanese letter codes', () => {
    expect(name('Common', 'asia', 'SV')).toBe('jp/c');
    expect(name('Double rare', 'asia', 'SV')).toBe('jp/rr');
    expect(name('Illustration rare', 'asia', 'SV')).toBe('jp/ar');
    expect(name('Ultra Rare', 'asia', 'SV')).toBe('jp/sr');
    expect(name('Holo Rare', 'asia', 'S')).toBe('jp/sr');
    expect(name('Secret Rare', 'asia', 'SM')).toBe('jp/ur');
    expect(name('Shiny Ultra Rare', 'asia', 'SM')).toBe('shining');
    expect(name('Classic Collection', 'asia', 'M')).toBe('classic-collection');
  });

  it('shows Mega Hyper Rare as MUR in the Mega Evolution series, UR elsewhere', () => {
    expect(name('Mega Hyper Rare', 'asia', 'M')).toBe('jp/mur');
    expect(name('Mega Hyper Rare', 'asia', 'SV')).toBe('jp/ur');
  });

  it('uses modern letter codes for Asian rarities without a series', () => {
    expect(name('Rare', 'asia')).toBe('jp/r');
    expect(name('Mega Hyper Rare', 'asia')).toBe('jp/ur');
  });

  it('gives older Asian sets the international symbols, every rare as a star', () => {
    expect(name('Common', 'asia', 'neo')).toBe('common');
    expect(name('Uncommon', 'asia', 'PCG')).toBe('uncommon');
    expect(name('Holo Rare', 'asia', 'PMCG')).toBe('rare');
    expect(name('Shiny rare', 'asia', 'PCG')).toBe('rare');
    expect(name('None', 'asia', 'PCG')).toBeNull();
  });

  it("repeats TCG Pocket's symbols in any region", () => {
    expect(rarityIcon('Three Diamond', 'intl')).toEqual({ name: 'pocket/diamond', count: 3 });
    expect(rarityIcon('Two Star', 'intl')).toEqual({ name: 'pocket/star', count: 2 });
    expect(rarityIcon('Two Shiny', 'asia')).toEqual({ name: 'pocket/shiny', count: 2 });
    expect(rarityIcon('Crown', 'intl')).toEqual({ name: 'pocket/crown', count: 1 });
  });

  it('has no symbol for None, a missing rarity, or one without a symbol', () => {
    expect(rarityIcon('None', 'intl')).toBeNull();
    expect(rarityIcon(null, 'intl')).toBeNull();
    expect(rarityIcon(undefined, 'asia')).toBeNull();
    expect(rarityIcon('', 'intl')).toBeNull();
    expect(rarityIcon('Triple Rare', 'intl')).toBeNull();
    expect(rarityIcon('toString', 'intl')).toBeNull();
    expect(rarityIcon('toString', 'asia', 'SV')).toBeNull();
  });

  it('builds the asset URL', () => {
    expect(rarityIconUrl('jp/rr')).toBe('assets/rarity/jp/rr.png');
  });
});
