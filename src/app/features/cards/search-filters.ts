import type { CatalogLanguage, CatalogSet } from '@pokepaper/shared';
import type { SeriesGroup } from '../../core/services/catalog-browse.service';
import { localized } from '../../core/services/catalog-browse.service';
import type {
  FilterCount,
  OwnedValue,
  SearchFilters,
} from '../../core/services/catalog-search.service';
import { normalizeSearchText } from '../../core/utils/search-text.util';
import { ENERGY_TYPES } from './energy';

/** The filter chips on the search results (docs/ui.md → Cards → Search). */
export type FilterKind = 'collection' | 'category' | 'type' | 'rarity' | 'illustrator' | 'set';
export const FILTER_KINDS: readonly FilterKind[] = [
  'collection',
  'category',
  'type',
  'rarity',
  'illustrator',
  'set',
];

export const FILTER_TITLES: Readonly<Record<FilterKind, string>> = {
  collection: 'Collection',
  category: 'Category',
  type: 'Type',
  rarity: 'Rarity',
  illustrator: 'Illustrator',
  set: 'Set',
};

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
  /** Energy type shown beside the label. */
  energy?: string;
  /** Rarity whose symbol is shown before the label. */
  rarity?: string;
  /** Set whose logo is shown beside the label. */
  set?: CatalogSet;
}

/** A group of options that can also be picked as a whole (a category, a series). */
export interface FilterGroup extends FilterOption {
  options: FilterOption[];
}

/** Which `SearchFilters` fields a picker's groups and options write. */
export const FILTER_FIELDS: Readonly<
  Record<FilterKind, { groups: keyof SearchFilters | null; options: keyof SearchFilters }>
> = {
  collection: { groups: null, options: 'owned' },
  category: { groups: 'categories', options: 'categories' },
  type: { groups: null, options: 'types' },
  rarity: { groups: null, options: 'rarities' },
  illustrator: { groups: null, options: 'illustrators' },
  set: { groups: 'series', options: 'sets' },
};

const CATEGORY_ORDER = ['Pokemon', 'Trainer', 'Energy'];
/** Only Trainer and Energy subtypes are offered (TCGdex has a few stray ones on Pokémon). */
const SUBTYPE_CATEGORIES = new Set(['Trainer', 'Energy']);

/**
 * `counts` plus any picked value it lacks, at 0: picks always stay listed so
 * they can be seen and cleared, even after the search leaves them no cards.
 */
export function withPicked(
  counts: readonly FilterCount[],
  picked: readonly string[]
): FilterCount[] {
  const listed = new Set(counts.map((entry) => entry.value));
  return [
    ...counts,
    ...picked.filter((value) => !listed.has(value)).map((value) => ({ value, count: 0 })),
  ];
}

export function categoryLabel(value: string): string {
  const [category = value, subtype] = value.split('/');
  if (subtype) {
    return category === 'Energy' && subtype === 'Normal' ? 'Basic' : subtype;
  }
  return category === 'Pokemon' ? 'Pokémon' : category;
}

/** Categories (most common first after Pokémon, Trainer, Energy), each with its subtypes. */
export function categoryGroups(counts: readonly FilterCount[]): FilterGroup[] {
  // A listed subtype keeps its category listed (at 0 if need be).
  const parents = counts.flatMap(({ value }) => {
    const [category = value] = value.split('/');
    return value.includes('/') ? [category] : [];
  });
  return withPicked(counts, parents)
    .filter(({ value }) => !value.includes('/'))
    .map<FilterGroup>(({ value, count }) => ({
      value,
      label: categoryLabel(value),
      count,
      options: SUBTYPE_CATEGORIES.has(value)
        ? counts
            .filter((entry) => entry.value.startsWith(`${value}/`))
            .map((entry) => ({ ...entry, label: categoryLabel(entry.value) }))
        : [],
    }))
    .sort((a, b) => categoryRank(a.value) - categoryRank(b.value));
}

function categoryRank(value: string): number {
  const index = CATEGORY_ORDER.indexOf(value);
  return index === -1 ? CATEGORY_ORDER.length : index;
}

/** Energy types in the TCG's order (unknown ones last). */
export function typeOptions(counts: readonly FilterCount[]): FilterOption[] {
  const rank = (value: string) => {
    const index = (ENERGY_TYPES as readonly string[]).indexOf(value);
    return index === -1 ? ENERGY_TYPES.length : index;
  };
  return [...counts]
    .sort((a, b) => rank(a.value) - rank(b.value) || a.value.localeCompare(b.value))
    .map(({ value, count }) => ({ value, label: value, count, energy: value }));
}

const OWNED_LABELS: Readonly<Record<OwnedValue, string>> = { owned: 'Owned', missing: 'Missing' };

function isOwnedValue(value: string): value is OwnedValue {
  return Object.hasOwn(OWNED_LABELS, value);
}

/** Owned, then Missing (docs/collection.md), both always offered. */
export function collectionOptions(
  counts: readonly { value: OwnedValue; count: number }[]
): FilterOption[] {
  return counts.map(({ value, count }) => ({ value, label: OWNED_LABELS[value], count }));
}

/** Rarities, most common first. */
export function rarityOptions(counts: readonly FilterCount[]): FilterOption[] {
  return counts.map(({ value, count }) => ({ value, label: value, count, rarity: value }));
}

/**
 * Illustrators A–Z by name (`names`, by filter value), keeping those whose
 * name contains `query`. Picked ones are expected in `counts` (`withPicked`).
 */
export function illustratorOptions(
  counts: readonly FilterCount[],
  names: ReadonlyMap<string, string>,
  query: string
): FilterOption[] {
  const needle = normalizeSearchText(query);
  return counts
    .map(({ value, count }) => ({ value, label: names.get(value) ?? value, count }))
    .filter((option) => normalizeSearchText(option.label).includes(needle))
    .sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));
}

/**
 * Series and their sets as in the sets list, with card counts. Keeps sets
 * with cards (by `counts`) or picked, and whose name or series name contains
 * `query`; a picked series stays listed even with none left.
 */
export function setGroups(
  groups: readonly SeriesGroup[],
  language: CatalogLanguage,
  query: string,
  counts: ReadonlyMap<string, number>,
  picked: { series: readonly string[]; sets: readonly string[] }
): FilterGroup[] {
  const needle = normalizeSearchText(query);
  return groups.flatMap((group) => {
    const seriesMatches = normalizeSearchText(group.name).includes(needle);
    const seriesPicked = picked.series.includes(group.key);
    const options = group.sets
      .map((set) => {
        const value = `${set.region}:${set.id}`;
        return { value, label: localized(set.names, language), set, count: counts.get(value) ?? 0 };
      })
      .filter(
        (option) =>
          (option.count > 0 || picked.sets.includes(option.value)) &&
          (seriesMatches || normalizeSearchText(option.label).includes(needle))
      );
    const count = options.reduce((total, option) => total + option.count, 0);
    return options.length > 0 || (seriesPicked && seriesMatches)
      ? [{ value: group.key, label: group.name, count, options }]
      : [];
  });
}

/** A filter's picked values, groups first. */
export function pickedValues(filters: SearchFilters, kind: FilterKind): string[] {
  const fields = FILTER_FIELDS[kind];
  return [
    ...(fields.groups && fields.groups !== fields.options ? filters[fields.groups] : []),
    ...filters[fields.options],
  ];
}

/** A filter's picks in short: "Fire" or "Fire +2", or null while unused. */
export function filterSummary(
  kind: FilterKind,
  filters: SearchFilters,
  label: (value: string) => string
): string | null {
  const values = pickedValues(filters, kind);
  if (values.length === 0) {
    return null;
  }
  const more = values.length > 1 ? ` +${String(values.length - 1)}` : '';
  return `${label(values[0])}${more}`;
}

/** A chip's label: "Type" while unused, else "Type: Fire" or "Type: Fire +2". */
export function chipLabel(
  kind: FilterKind,
  filters: SearchFilters,
  label: (value: string) => string
): string {
  const summary = filterSummary(kind, filters, label);
  return summary ? `${FILTER_TITLES[kind]}: ${summary}` : FILTER_TITLES[kind];
}

/** What the current catalog calls its sets, series and illustrators, for labeling picks. */
export interface FilterNames {
  sets: ReadonlyMap<string, { set: CatalogSet }>;
  seriesNames: ReadonlyMap<string, string>;
  /** Illustrator names by filter value (`illustratorKey`). */
  illustrators: ReadonlyMap<string, string>;
  language: CatalogLanguage;
}

/** How a picked value of `kind` reads: "Supporter", "Paldea Evolved", "Fire", "Ken Sugimori". */
export function valueLabel(kind: FilterKind, names: FilterNames): (value: string) => string {
  return (value) => {
    switch (kind) {
      case 'collection':
        return isOwnedValue(value) ? OWNED_LABELS[value] : value;
      case 'category':
        return categoryLabel(value);
      case 'illustrator':
        return names.illustrators.get(value) ?? value;
      case 'set': {
        const set = names.sets.get(value)?.set;
        return set ? localized(set.names, names.language) : (names.seriesNames.get(value) ?? value);
      }
      default:
        return value;
    }
  };
}

/** `filters` without any value of `kind`. */
export function withoutKind(filters: SearchFilters, kind: FilterKind): SearchFilters {
  const fields = FILTER_FIELDS[kind];
  return {
    ...filters,
    [fields.options]: [],
    ...(fields.groups ? { [fields.groups]: [] } : {}),
  };
}

export function kindActive(filters: SearchFilters, kind: FilterKind): boolean {
  const fields = FILTER_FIELDS[kind];
  return (
    filters[fields.options].length > 0 ||
    (fields.groups ? filters[fields.groups].length > 0 : false)
  );
}
