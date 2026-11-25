import type { CatalogCard, CatalogCardText } from '@pokepaper/shared';
import { checkProductLink } from './product-check.js';

/** A card with English text: its name, attacks and abilities. */
const card = (
  name: string,
  attacks: string[] = [],
  abilities: string[] = []
): Pick<CatalogCard, 'text'> => ({
  text: {
    en: {
      name,
      attacks: attacks.map((attack) => ({ name: attack, effect: null })),
      abilities: abilities.map((ability) => ({ type: 'Ability', name: ability, effect: null })),
    } as unknown as CatalogCardText,
  },
});
const product = (name: string) => ({ name });

describe('checkProductLink', () => {
  it('accepts a product named like the card, sharing an attack or ability', () => {
    expect(checkProductLink(card('Pineco', ['Guard Press']), product('Pineco [Guard Press]'))).toBe(
      'ok'
    );
    // Cardmarket lists Poké-Powers and Poké-Bodies with the attacks.
    expect(
      checkProductLink(
        card('Typhlosion', ['Flare Destroy'], ['Afterburner']),
        product('Typhlosion [Afterburner | Flare Destroy | Prime]')
      )
    ).toBe('ok');
  });

  it('reads names Cardmarket spells its own way', () => {
    expect(checkProductLink(card('M Mewtwo EX'), product('MMewtwo EX [Vanishing Strike]'))).toBe(
      'ok'
    );
    expect(
      checkProductLink(card('Pelipper', ['Water Pulse']), product('Pelipper Lv.50 [Water Pulse]'))
    ).toBe('ok');
    // Bracketed level-up groups before the attacks: the attacks are the last brackets.
    expect(
      checkProductLink(
        card('Staraptor FB', ['Quick Attack']),
        product('Staraptor [FB] Lv.50 [Quick Attack | Whirlwind]')
      )
    ).toBe('ok');
    expect(checkProductLink(card('Adventure Lantern'), product('Adventuring Lantern'))).toBe('ok');
    expect(
      checkProductLink(card('Legendary Trench'), product('Legendary Marine Trench [Right]'))
    ).toBe('ok');
    expect(
      checkProductLink(
        card('Blend Energy Grass Fire Psychic Darkness'),
        product('Blend Energy GFPD')
      )
    ).toBe('ok');
    // Attacks spelled another way.
    expect(
      checkProductLink(
        card('Unown VSTAR', ['Star Cipher']),
        product('Unown VSTAR [Tri Power | Star Cypher]')
      )
    ).toBe('ok');
  });

  it('accepts what it can’t compare: no attacks on either side, or a split card’s half', () => {
    expect(checkProductLink(card('Switch'), product('Switch'))).toBe('ok');
    expect(checkProductLink(card('Bulbasaur', ['Vine Whip']), product('Bulbasaur'))).toBe('ok');
    expect(
      checkProductLink(card('Ho-Oh LEGEND', ['Bright Wing']), product('Ho-Oh LEGEND [Top]'))
    ).toBe('ok');
    // McDonald's cards list the Pokémon's own name among their attacks in some data.
    expect(checkProductLink(card('Woobat', ['Woobat']), product('Woobat [Psy Bolt]'))).toBe('ok');
  });

  it('flags a product named for another card', () => {
    // Team Magma vs Team Aqua's Maxie.
    expect(checkProductLink(card('Maxie'), product('Psyduck [Confusion Wave | SS]'))).toBe(
      'other_card'
    );
    expect(checkProductLink(card("Team Aqua's Walrein"), product("Team Aqua's Sealeo [Ram]"))).toBe(
      'other_card'
    );
  });

  it('tells Nidoran♀ from Nidoran♂, however Cardmarket writes the sign', () => {
    const female = card('Nidoran♀', ['Double Kick']);
    expect(checkProductLink(female, product('Nidoran ♂ [Double Kick]'))).toBe('other_card');
    expect(checkProductLink(female, product('Nidoran &male; [Double Kick]'))).toBe('other_card');
    expect(checkProductLink(female, product('Nidoran ♀ [Double Kick]'))).toBe('ok');
    expect(checkProductLink(female, product('Nidoran &female; [Double Kick]'))).toBe('ok');
    // Many products leave the sign out: either card's.
    expect(checkProductLink(female, product('Nidoran [Double Kick]'))).toBe('ok');
    expect(
      checkProductLink(card("Team Rocket's Nidoran♂"), product("Team Rocket's Nidoran ♀"))
    ).toBe('other_card');
    // A name with both signs is either.
    expect(checkProductLink(card('Nidoran♀ & Nidoran♂'), product('Nidoran ♀ & Nidoran ♂'))).toBe(
      'ok'
    );
  });

  it('never takes a name inside another for it', () => {
    expect(checkProductLink(card('N'), product('Nidoking [Poison Jab]'))).toBe('other_card');
    expect(checkProductLink(card('Mew', ['Psywave']), product('Mewtwo [Super Psywave]'))).toBe(
      'other_card'
    );
  });

  it('reads moves only from brackets ending the name, never a tag from the card’s name', () => {
    expect(
      checkProductLink(card('Staraptor FB', ['Quick Attack']), product('Staraptor [FB] Lv.50'))
    ).toBe('ok');
    expect(
      checkProductLink(
        card('Ancient Technical Machine [Ice]', ['Ice Generator']),
        product('Ancient Technical Machine [Ice]')
      )
    ).toBe('ok');
  });

  it('reads accented names word by word without splitting at the accent', () => {
    expect(
      checkProductLink(
        card('Pokémon Communication'),
        product('Pokemon Communication (Team Plasma)')
      )
    ).toBe('ok');
    expect(
      checkProductLink(card('Flabébé', ['Razor Leaf']), product('Flabébé Lv.10 [Razor Leaf]'))
    ).toBe('ok');
  });

  it('takes a bracket of only set codes or letters for tags, not moves', () => {
    // Tags alone: nothing to compare, so not another printing.
    expect(
      checkProductLink(
        card('Tohoku’s Pikachu', ['Thunder Shock']),
        product('Tohoku’s Pikachu [SV-P]')
      )
    ).toBe('ok');
    expect(checkProductLink(card('Unown', ['Hidden Power']), product('Unown [A]'))).toBe('ok');
    // Unown's four-letter Poké-Powers are moves, even alone.
    expect(checkProductLink(card('Unown', ['DARK']), product('Unown [HEAL]'))).toBe(
      'other_printing'
    );
    // Tags beside moves: the moves decide.
    expect(
      checkProductLink(card('Bulbasaur', ['Leech Seed']), product('Bulbasaur [Leech Seed | MEP]'))
    ).toBe('ok');
    expect(
      checkProductLink(card('Bulbasaur', ['Vine Whip']), product('Bulbasaur [Leech Seed | 151]'))
    ).toBe('other_printing');
    // Short moves, capitalized or all caps beside others, are moves.
    expect(checkProductLink(card('Tauros', ['Horn Attack']), product('Tauros [Ram]'))).toBe(
      'other_printing'
    );
    expect(
      checkProductLink(
        card('Unown', ['DARK', 'Hidden Power']),
        product('Unown [C] [CALL | Psychic]')
      )
    ).toBe('other_printing');
  });

  it('flags another printing of the card: its name, none of its attacks', () => {
    // Short moves one letter apart are other moves.
    expect(checkProductLink(card('Zubat', ['Bite']), product('Zubat [Bide]'))).toBe(
      'other_printing'
    );
    // HeartGold & SoulSilver's Typhlosion Prime, linked to the plain one.
    expect(
      checkProductLink(
        card('Typhlosion', ['Flare Destroy'], ['Afterburner']),
        product('Typhlosion [Magma Punch | Fire Spin]')
      )
    ).toBe('other_printing');
  });

  it('can’t check a card without English text, or a product without a name', () => {
    expect(
      checkProductLink(
        { text: { fr: { name: 'Chétiflor' } as unknown as CatalogCardText } },
        product('Bellsprout [Blot]')
      )
    ).toBe('unchecked');
    expect(checkProductLink(card('Maxie'), product('[Promo]'))).toBe('unchecked');
  });
});
