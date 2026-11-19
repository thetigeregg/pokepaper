import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { RARITY_ICON_HEIGHT, RARITY_ICON_WIDTHS, rarityIcon, rarityIconUrl } from './rarity';

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

  it('gives Asian rarities without a series their most common symbol', () => {
    expect(name('Rare', 'asia')).toBe('jp/r');
    expect(name('Mega Hyper Rare', 'asia')).toBe('jp/ur');
    // Almost all on pre-Black & White cards, which print ★.
    expect(name('Holo Rare', 'asia')).toBe('rare');
    expect(name('Shiny rare', 'asia')).toBe('rare');
  });

  it('gives older Asian sets the international symbols, every rare as a star', () => {
    expect(name('Common', 'asia', 'neo')).toBe('common');
    expect(name('Uncommon', 'asia', 'PCG')).toBe('uncommon');
    expect(name('Holo Rare', 'asia', 'PMCG')).toBe('rare');
    expect(name('Shiny rare', 'asia', 'PCG')).toBe('rare');
    expect(name('None', 'asia', 'PCG')).toBeNull();
    expect(name('Promo', 'asia', 'PCG')).toBeNull(); // Not in the table: text only.
  });

  it("repeats TCG Pocket's symbols in any region", () => {
    expect(rarityIcon('Three Diamond', 'intl')).toEqual({
      name: 'pocket/diamond',
      count: 3,
      width: 37,
    });
    expect(rarityIcon('Two Star', 'intl')).toMatchObject({ name: 'pocket/star', count: 2 });
    expect(rarityIcon('Two Shiny', 'asia')).toMatchObject({ name: 'pocket/shiny', count: 2 });
    expect(rarityIcon('Crown', 'intl')).toMatchObject({ name: 'pocket/crown', count: 1 });
  });

  it("gives each symbol its image's width", () => {
    expect(rarityIcon('Double rare', 'intl')).toEqual({ name: 'double-rare', count: 1, width: 72 });
    expect(rarityIcon('Common', 'asia', 'SV')).toEqual({ name: 'jp/c', count: 1, width: 43 });
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

describe('RARITY_ICON_WIDTHS', () => {
  const root = join(process.cwd(), 'src/assets/rarity');

  function pngs(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? pngs(join(dir, entry.name))
        : entry.name.endsWith('.png')
          ? [join(dir, entry.name)]
          : []
    );
  }

  it('lists every image in assets/rarity with its size', () => {
    const sizes = Object.fromEntries(
      pngs(root).map((file) => {
        const png = readFileSync(file);
        // PNG header: width and height are the IHDR chunk's first two fields.
        const name = relative(root, file)
          .replace(/\\/g, '/')
          .replace(/\.png$/, '');
        return [name, [png.readUInt32BE(16), png.readUInt32BE(20)]];
      })
    );

    expect(sizes).toEqual(
      Object.fromEntries(
        Object.entries(RARITY_ICON_WIDTHS).map(([name, width]) => [
          name,
          [width, RARITY_ICON_HEIGHT],
        ])
      )
    );
  });
});
