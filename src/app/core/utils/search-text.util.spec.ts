import { describe, expect, it } from 'vitest';
import {
  cardMatches,
  illustratorKey,
  illustratorName,
  normalizeSearchText,
  parseCardNumber,
  prepareName,
  prepareQuery,
} from './search-text.util';

function matches(name: string, query: string): boolean {
  const prepared = prepareQuery(query);
  if (!prepared) {
    throw new Error('empty query');
  }
  return cardMatches({ names: [prepareName(normalizeSearchText(name))], number: null }, prepared);
}

describe('normalizeSearchText', () => {
  it('lowercases and drops accents', () => {
    expect(normalizeSearchText('Pokémon Évoli')).toBe('pokemon evoli');
  });

  it('turns punctuation and symbols into single spaces', () => {
    expect(normalizeSearchText("  Farfetch'd  ")).toBe('farfetch d');
    expect(normalizeSearchText('Mr. Mime')).toBe('mr mime');
    expect(normalizeSearchText('Nidoran♀')).toBe('nidoran');
    expect(normalizeSearchText('Porygon-Z')).toBe('porygon z');
  });

  it('makes full-width letters plain', () => {
    expect(normalizeSearchText('ＧＸ')).toBe('gx');
  });

  it('writes hiragana as katakana, keeping voicing marks', () => {
    expect(normalizeSearchText('ぴかちゅう')).toBe('ピカチュウ');
    expect(normalizeSearchText('ガブリアス')).toBe('ガブリアス');
    expect(normalizeSearchText('ｶﾞﾌﾞﾘｱｽ')).toBe('ガブリアス'); // Half-width.
  });

  it('leaves Chinese as it is', () => {
    expect(normalizeSearchText('妙蛙種子')).toBe('妙蛙種子');
  });
});

describe('cardMatches by name', () => {
  it('matches the start of any word', () => {
    expect(matches('Pikachu ex', 'pika')).toBe(true);
    expect(matches('Pikachu ex', 'EX')).toBe(true);
    expect(matches('Pikachu ex', 'kachu')).toBe(false);
  });

  it('needs every query word', () => {
    expect(matches("Team Rocket's Mewtwo ex", 'rocket mew')).toBe(true);
    expect(matches("Team Rocket's Mewtwo ex", 'rocket pika')).toBe(false);
  });

  it('matches names whose punctuation the query leaves out', () => {
    expect(matches("Farfetch'd", 'farfetchd')).toBe(true);
    expect(matches('Mr. Mime', 'mrmi')).toBe(true);
  });

  it('ignores accents in the query', () => {
    expect(matches('Pokémon Center Lady', 'pokemon')).toBe(true);
    expect(matches('Pokemon Center Lady', 'pokémon')).toBe(true);
  });

  it('matches Japanese and Chinese anywhere in the name', () => {
    expect(matches('ヒスイのゾロアーク', 'ゾロア')).toBe(true);
    expect(matches('ピカチュウex', 'ぴかちゅう')).toBe(true);
    expect(matches('妙蛙種子', '種子')).toBe(true);
    expect(matches('妙蛙種子', '小火龍')).toBe(false);
  });

  it('has nothing to search for in a blank query', () => {
    expect(prepareQuery('  ')).toBeNull();
    expect(prepareQuery('!?')).toBeNull();
  });
});

describe('parseCardNumber', () => {
  it('splits a number into prefix, value and suffix', () => {
    expect(parseCardNumber('067')).toEqual({ prefix: '', value: 67, suffix: '' });
    expect(parseCardNumber('TG05')).toEqual({ prefix: 'tg', value: 5, suffix: '' });
    expect(parseCardNumber('XY67a')).toEqual({ prefix: 'xy', value: 67, suffix: 'a' });
    expect(parseCardNumber('６７')).toEqual({ prefix: '', value: 67, suffix: '' }); // Full-width.
  });

  it("is null for what isn't a number", () => {
    expect(parseCardNumber('LIG')).toBeNull();
    expect(parseCardNumber('Museum')).toBeNull();
    expect(parseCardNumber('SV-P 098')).toBeNull();
    expect(parseCardNumber('')).toBeNull();
  });
});

describe('cardMatches', () => {
  function card(names: string[], number: string) {
    return {
      names: names.map((name) => prepareName(normalizeSearchText(name))),
      number: parseCardNumber(number),
    };
  }

  function matchesCard(names: string[], number: string, query: string): boolean {
    const prepared = prepareQuery(query);
    if (!prepared) {
      throw new Error('empty query');
    }
    return cardMatches(card(names, number), prepared);
  }

  it('matches a name and a number together, or a number alone', () => {
    expect(matchesCard(['Meowth'], '67', 'meowth 67')).toBe(true);
    expect(matchesCard(['Meowth'], '67', '67 meow')).toBe(true);
    expect(matchesCard(['Meowth'], '68', 'meowth 67')).toBe(false);
    expect(matchesCard(['Pikachu'], '67', 'meowth 67')).toBe(false);
    expect(matchesCard(['Meowth'], '67', '67')).toBe(true);
  });

  it('matches the whole number, whatever its padding', () => {
    expect(matchesCard(['Meowth'], '067', '67')).toBe(true);
    expect(matchesCard(['Meowth'], '67', '0067')).toBe(true);
    expect(matchesCard(['Meowth'], '167', '67')).toBe(false);
    expect(matchesCard(['Meowth'], '67', '6')).toBe(false);
  });

  it('needs the same prefix, and the suffix when the query has one', () => {
    expect(matchesCard(['Pikachu'], 'TG05', 'tg5')).toBe(true);
    expect(matchesCard(['Pikachu'], 'TG05', '5')).toBe(false);
    expect(matchesCard(['Pikachu'], '5', 'tg5')).toBe(false);
    expect(matchesCard(['Pikachu'], 'SWSH067', 'pika swsh067')).toBe(true);
    expect(matchesCard(['Unown'], '50b', '50')).toBe(true);
    expect(matchesCard(['Unown'], '50b', '50b')).toBe(true);
    expect(matchesCard(['Unown'], '50b', '50a')).toBe(false);
  });

  it('still matches numbers in names', () => {
    expect(matchesCard(['Energy Removal 2'], '81', 'energy removal 2')).toBe(true);
    expect(matchesCard(['Fire Cube 01'], '128', 'cube 01')).toBe(true);
    expect(matchesCard(['Energy Removal 2'], '81', 'energy removal 3')).toBe(false);
  });

  it('matches a number in any language of the card, or one without a name', () => {
    expect(matchesCard(['Pineco', 'Pomdépik'], '1', 'pomdepik 1')).toBe(true);
    expect(matchesCard(['ニャース'], '067', 'にゃーす 67')).toBe(true);
    expect(matchesCard([], '67', '67')).toBe(true);
    expect(matchesCard([], 'LIG', '67')).toBe(false);
  });
});

describe('illustratorKey', () => {
  it('makes spellings that differ in case, spaces or punctuation one artist', () => {
    expect(illustratorKey('aky CG Works')).toBe('akycgworks');
    expect(illustratorKey('akyCG Works')).toBe('akycgworks');
    expect(illustratorKey('Takuyoa')).toBe(illustratorKey('takuyoa'));
    expect(illustratorKey('Mékayu')).toBe('mekayu');
  });

  it('has no key without a name', () => {
    expect(illustratorKey(null)).toBeNull();
    expect(illustratorKey(undefined)).toBeNull();
    expect(illustratorKey('  ')).toBeNull();
    expect(illustratorKey('N/A')).toBeNull();
  });
});

describe('illustratorName', () => {
  it('keeps the spelling, trimmed, and has none without a key', () => {
    expect(illustratorName(' aky CG Works ')).toBe('aky CG Works');
    expect(illustratorName('N/A')).toBeNull();
    expect(illustratorName(null)).toBeNull();
  });
});
