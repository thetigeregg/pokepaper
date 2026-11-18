import type { CatalogLanguage, CatalogSet } from '@pokepaper/shared';
import type { SeriesGroup } from '../../core/services/catalog-browse.service';
import { localized } from '../../core/services/catalog-browse.service';
import type { FilterCount, SearchFilters } from '../../core/services/catalog-search.service';
import { normalizeSearchText } from '../../core/utils/search-text.util';
import { ENERGY_TYPES } from './energy';

/** The filter chips on the search results (docs/ui.md → Cards → Search). */
export type FilterKind = 'category' | 'type' | 'rarity' | 'set';
export const FILTER_KINDS: readonly FilterKind[] = ['category', 'type', 'rarity', 'set'];

export const FILTER_TITLES: Readonly<Record<FilterKind, string>> = {
  category: 'Category',
  type: 'Type',
  rarity: 'Rarity',
  set: 'Set',
};

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
  /** Energy type shown beside the label. */
  energy?: string;
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
  category: { groups: 'categories', options: 'categories' },
  type: { groups: null, options: 'types' },
  rarity: { groups: null, options: 'rarities' },
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

/** Rarities, most common first. */
export function rarityOptions(counts: readonly FilterCount[]): FilterOption[] {
  return counts.map(({ value, count }) => ({ value, label: value, count }));
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

/** A chip's label: "Type" while unused, else "Type: Fire" or "Type: Fire +2". */
export function chipLabel(
  kind: FilterKind,
  filters: SearchFilters,
  label: (value: string) => string
): string {
  const fields = FILTER_FIELDS[kind];
  const values = [
    ...(fields.groups && fields.groups !== fields.options ? filters[fields.groups] : []),
    ...filters[fields.options],
  ];
  if (values.length === 0) {
    return FILTER_TITLES[kind];
  }
  const more = values.length > 1 ? ` +${String(values.length - 1)}` : '';
  return `${FILTER_TITLES[kind]}: ${label(values[0])}${more}`;
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
