/**
 * Energy types: the letters TCGdex uses in rules text ({G}, {R}, …), and a
 * color per type for the stand-in icons and the no-scan card tint.
 */
export const ENERGY_TYPES = [
  'Grass',
  'Fire',
  'Water',
  'Lightning',
  'Psychic',
  'Fighting',
  'Darkness',
  'Metal',
  'Fairy',
  'Dragon',
  'Colorless',
] as const;
export type EnergyType = (typeof ENERGY_TYPES)[number];

export const ENERGY_LETTERS: Readonly<Partial<Record<string, EnergyType>>> = {
  G: 'Grass',
  R: 'Fire',
  W: 'Water',
  L: 'Lightning',
  P: 'Psychic',
  F: 'Fighting',
  D: 'Darkness',
  M: 'Metal',
  Y: 'Fairy',
  N: 'Dragon',
  C: 'Colorless',
};

/** Letter shown in the stand-in icon (the card text's own letters). */
export const ENERGY_SYMBOL: Readonly<Record<EnergyType, string>> = {
  Grass: 'G',
  Fire: 'R',
  Water: 'W',
  Lightning: 'L',
  Psychic: 'P',
  Fighting: 'F',
  Darkness: 'D',
  Metal: 'M',
  Fairy: 'Y',
  Dragon: 'N',
  Colorless: 'C',
};

export const ENERGY_COLORS: Readonly<Record<EnergyType, string>> = {
  Grass: '#4caf50',
  Fire: '#e8513a',
  Water: '#2f8fd8',
  Lightning: '#f5c51b',
  Psychic: '#9b59b6',
  Fighting: '#c0692b',
  Darkness: '#2d3a3f',
  Metal: '#8e9aa3',
  Fairy: '#e86fa6',
  Dragon: '#b08d2e',
  Colorless: '#c9c3b6',
};

export function isEnergyType(value: string): value is EnergyType {
  return (ENERGY_TYPES as readonly string[]).includes(value);
}

/** A piece of card text: plain text, or an energy symbol. */
export type TextSegment = { text: string } | { energy: EnergyType };

/** Splits rules text into text and energy symbols: "attach a {P} Energy" → text, Psychic, text. */
export function parseCardText(value: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of value.matchAll(/\{([A-Z])\}/g)) {
    const energy = ENERGY_LETTERS[match[1]];
    if (!energy) {
      continue;
    }
    if (match.index > last) {
      segments.push({ text: value.slice(last, match.index) });
    }
    segments.push({ energy });
    last = match.index + match[0].length;
  }
  if (last < value.length) {
    segments.push({ text: value.slice(last) });
  }
  return segments;
}
