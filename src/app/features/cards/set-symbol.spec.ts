import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SET_SYMBOL_HEIGHT, SET_SYMBOL_WIDTHS, setSymbol } from './set-symbol';

describe('setSymbol', () => {
  it("gives an International set its symbol and the image's width", () => {
    expect(setSymbol('intl', 'sv08')).toEqual({
      url: 'assets/set-symbols/sv08.png',
      width: SET_SYMBOL_WIDTHS['sv08'],
    });
  });

  it("gives MEP Black Star Promos the other Black Star Promos' star", () => {
    expect(setSymbol('intl', 'mep')).toEqual({
      url: 'assets/set-symbols/svp.png',
      width: SET_SYMBOL_WIDTHS['svp'],
    });
    expect(setSymbol('asia', 'mep')).toBeNull();
  });

  it('has no symbol for a set without one', () => {
    expect(setSymbol('intl', 'base1')).toBeNull();
    expect(setSymbol('intl', 'A1')).toBeNull();
  });

  it('has no symbol in the Japan & Asia catalog, even for an ID shared with an International set', () => {
    expect(setSymbol('intl', 'neo1')).not.toBeNull();
    expect(setSymbol('asia', 'neo1')).toBeNull();
    expect(setSymbol('asia', 'SV8')).toBeNull();
  });

  it("doesn't read inherited properties as set IDs", () => {
    expect(setSymbol('intl', 'constructor')).toBeNull();
    expect(setSymbol('intl', 'toString')).toBeNull();
  });
});

describe('SET_SYMBOL_WIDTHS', () => {
  const root = join(process.cwd(), 'src/assets/set-symbols');

  it('lists every image in assets/set-symbols with its size', () => {
    const sizes = Object.fromEntries(
      readdirSync(root)
        .filter((file) => file.endsWith('.png'))
        .map((file) => {
          const png = readFileSync(join(root, file));
          // PNG header: width and height are the IHDR chunk's first two fields.
          return [file.replace(/\.png$/, ''), [png.readUInt32BE(16), png.readUInt32BE(20)]];
        })
    );

    expect(sizes).toEqual(
      Object.fromEntries(
        Object.entries(SET_SYMBOL_WIDTHS).map(([setId, width]) => [
          setId,
          [width, SET_SYMBOL_HEIGHT],
        ])
      )
    );
  });
});
