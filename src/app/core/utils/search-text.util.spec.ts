import { describe, expect, it } from 'vitest';
import { nameMatches, normalizeSearchText, prepareName, prepareQuery } from './search-text.util';

function matches(name: string, query: string): boolean {
  const prepared = prepareQuery(query);
  if (!prepared) {
    throw new Error('empty query');
  }
  return nameMatches(prepareName(normalizeSearchText(name)), prepared);
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

describe('nameMatches', () => {
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
