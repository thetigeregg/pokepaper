import { describe, expect, it } from 'vitest';
import { makeContractPack } from '../../core/data/storage-engine.contract';
import { NO_FILTERS } from '../../core/services/catalog-search.service';
import {
  categoryGroups,
  categoryLabel,
  chipLabel,
  collectionOptions,
  kindActive,
  rarityOptions,
  setGroups,
  typeOptions,
  valueLabel,
  withPicked,
  withoutKind,
} from './search-filters';

describe('search filters', () => {
  it('labels categories and subtypes', () => {
    expect(categoryLabel('Pokemon')).toBe('Pokémon');
    expect(categoryLabel('Trainer')).toBe('Trainer');
    expect(categoryLabel('Trainer/Supporter')).toBe('Supporter');
    expect(categoryLabel('Energy/Normal')).toBe('Basic');
    expect(categoryLabel('Energy/Special')).toBe('Special');
  });

  it('groups subtypes under Trainer and Energy, in the TCG order', () => {
    const groups = categoryGroups([
      { value: 'Pokemon', count: 30 },
      { value: 'Energy', count: 12 },
      { value: 'Trainer', count: 10 },
      { value: 'Trainer/Supporter', count: 6 },
      { value: 'Trainer/Item', count: 4 },
      { value: 'Energy/Normal', count: 9 },
      { value: 'Pokemon/Tool', count: 1 }, // A stray TCGdex subtype: not offered.
      { value: 'Mystery', count: 1 },
    ]);

    expect(groups.map((group) => [group.label, group.options.map((o) => o.label)])).toEqual([
      ['Pokémon', []],
      ['Trainer', ['Supporter', 'Item']],
      ['Energy', ['Basic']],
      ['Mystery', []],
    ]);
  });

  it('orders types like the TCG, unknown ones last', () => {
    const options = typeOptions([
      { value: 'Water', count: 5 },
      { value: 'Shadow', count: 1 },
      { value: 'Grass', count: 2 },
      { value: 'Crystal', count: 1 },
    ]);

    expect(options.map((option) => [option.value, option.energy])).toEqual([
      ['Grass', 'Grass'],
      ['Water', 'Water'],
      ['Crystal', 'Crystal'],
      ['Shadow', 'Shadow'],
    ]);
  });

  it('keeps rarities most common first', () => {
    expect(
      rarityOptions([
        { value: 'Common', count: 9 },
        { value: 'Rare', count: 2 },
      ]).map((option) => option.label)
    ).toEqual(['Common', 'Rare']);
  });

  it('lists sets by series, keeping those whose name or series matches', () => {
    const sv01 = { ...makeContractPack('intl', 'sv01', []).set, names: { en: 'Scarlet & Violet' } };
    const sv02 = { ...makeContractPack('intl', 'sv02', []).set, names: { en: 'Paldea Evolved' } };
    const swsh1 = { ...makeContractPack('intl', 'swsh1', []).set, names: { en: 'Sword & Shield' } };
    const series = [
      { key: 'intl:sv', name: 'Scarlet & Violet', sets: [sv02, sv01] },
      { key: 'intl:swsh', name: 'Sword & Shield', sets: [swsh1] },
    ];

    const all = new Map([
      ['intl:sv01', 3],
      ['intl:sv02', 2],
      ['intl:swsh1', 1],
    ]);
    const none = { series: [], sets: [] };
    const groups = (query: string) => setGroups(series, 'en', query, all, none);

    expect(groups('').map((group) => [group.count, group.options.length])).toEqual([
      [5, 2],
      [1, 1],
    ]);
    expect(
      groups('paldéa').map((group) => [group.value, group.options.map((option) => option.value)])
    ).toEqual([['intl:sv', ['intl:sv02']]]);
    // A matching series keeps all its sets.
    expect(groups('sword')[0]?.options.map((option) => option.label)).toEqual(['Sword & Shield']);
    expect(groups('scarlet')[0]?.options).toHaveLength(2);
  });

  it('leaves out sets the search has no cards in, unless picked', () => {
    const sv01 = makeContractPack('intl', 'sv01', []).set;
    const sv02 = makeContractPack('intl', 'sv02', []).set;
    const swsh1 = makeContractPack('intl', 'swsh1', []).set;
    const series = [
      { key: 'intl:sv', name: 'Scarlet & Violet', sets: [sv02, sv01] },
      { key: 'intl:swsh', name: 'Sword & Shield', sets: [swsh1] },
    ];
    const counts = new Map([['intl:sv01', 4]]);

    const listed = (picked: { series: string[]; sets: string[] }, query = '') =>
      setGroups(series, 'en', query, counts, picked).map((group) => [
        group.value,
        group.options.map((option) => [option.value, option.count]),
      ]);

    expect(listed({ series: [], sets: [] })).toEqual([['intl:sv', [['intl:sv01', 4]]]]);
    expect(listed({ series: [], sets: ['intl:sv02'] })).toEqual([
      [
        'intl:sv',
        [
          ['intl:sv02', 0],
          ['intl:sv01', 4],
        ],
      ],
    ]);
    // A picked series with no cards left stays, so it can be cleared…
    expect(listed({ series: ['intl:swsh'], sets: [] })).toEqual([
      ['intl:sv', [['intl:sv01', 4]]],
      ['intl:swsh', []],
    ]);
    // …unless the set search hides it.
    expect(listed({ series: ['intl:swsh'], sets: [] }, 'scarlet')).toEqual([
      ['intl:sv', [['intl:sv01', 4]]],
    ]);
  });

  it('keeps picked values listed at 0', () => {
    expect(withPicked([{ value: 'Fire', count: 3 }], ['Fire', 'Water'])).toEqual([
      { value: 'Fire', count: 3 },
      { value: 'Water', count: 0 },
    ]);
  });

  it('keeps a category listed while one of its subtypes is', () => {
    const groups = categoryGroups([{ value: 'Trainer/Item', count: 0 }]);

    expect(groups.map((group) => [group.value, group.count, group.options.length])).toEqual([
      ['Trainer', 0, 1],
    ]);
  });

  it('labels chips with the filter, its first value and how many more', () => {
    const label = (value: string) => value.toUpperCase();

    expect(chipLabel('type', NO_FILTERS, label)).toBe('Type');
    expect(chipLabel('type', { ...NO_FILTERS, types: ['Fire'] }, label)).toBe('Type: FIRE');
    expect(chipLabel('type', { ...NO_FILTERS, types: ['Fire', 'Water', 'Grass'] }, label)).toBe(
      'Type: FIRE +2'
    );
    expect(
      chipLabel('set', { ...NO_FILTERS, series: ['intl:sv'], sets: ['intl:swsh1'] }, label)
    ).toBe('Set: INTL:SV +1');
    expect(chipLabel('category', { ...NO_FILTERS, categories: ['Trainer'] }, label)).toBe(
      'Category: TRAINER'
    );
  });

  it('clears and checks one filter, series and sets together', () => {
    const filters = { ...NO_FILTERS, types: ['Fire'], series: ['intl:sv'], sets: ['intl:swsh1'] };

    expect(kindActive(filters, 'set')).toBe(true);
    expect(kindActive({ ...NO_FILTERS, series: ['intl:sv'] }, 'set')).toBe(true);
    expect(kindActive(filters, 'rarity')).toBe(false);
    expect(withoutKind(filters, 'set')).toEqual({ ...NO_FILTERS, types: ['Fire'] });
    expect(withoutKind(filters, 'type')).toEqual({ ...filters, types: [] });
  });

  it('labels the collection filter', () => {
    expect(
      collectionOptions([
        { value: 'owned', count: 2 },
        { value: 'missing', count: 9 },
      ])
    ).toEqual([
      { value: 'owned', label: 'Owned', count: 2 },
      { value: 'missing', label: 'Missing', count: 9 },
    ]);
    const label = valueLabel('collection', {
      sets: new Map(),
      seriesNames: new Map(),
      language: 'en',
    });
    expect(chipLabel('collection', { ...NO_FILTERS, owned: ['owned', 'missing'] }, label)).toBe(
      'Collection: Owned +1'
    );
    expect(label('toString')).toBe('toString'); // Only its own statuses get labels.
    expect(kindActive(NO_FILTERS, 'collection')).toBe(false);
    expect(withoutKind({ ...NO_FILTERS, owned: ['owned'] }, 'collection')).toEqual(NO_FILTERS);
  });
});
