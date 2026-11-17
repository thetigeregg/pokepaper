import { parseCardText } from './energy';

describe('parseCardText', () => {
  it('splits text around energy symbols', () => {
    expect(parseCardText('Attach a Basic {P} Energy to {C}{C} Pokémon.')).toEqual([
      { text: 'Attach a Basic ' },
      { energy: 'Psychic' },
      { text: ' Energy to ' },
      { energy: 'Colorless' },
      { energy: 'Colorless' },
      { text: ' Pokémon.' },
    ]);
  });

  it('leaves unknown letters and plain text alone', () => {
    expect(parseCardText('{X} damage')).toEqual([{ text: '{X} damage' }]);
    expect(parseCardText('')).toEqual([]);
  });
});
