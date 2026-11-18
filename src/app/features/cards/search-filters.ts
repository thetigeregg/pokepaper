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

export function categoryLabel(value: string): string {
  const [category = value, subtype] = value.split('/');
  if (subtype) {
    return category === 'Energy' && subtype === 'Normal' ? 'Basic' : subtype;
  }
  return category === 'Pokemon' ? 'Pokémon' : category;
}

/** Categories (most common first after Pokémon, Trainer, Energy), each with its subtypes. */
export function categoryGroups(counts: readonly FilterCount[]): FilterGroup[] {
  const groups = counts
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
    }));
  const rank = (value: string) => {
    const index = CATEGORY_ORDER.indexOf(value);
    return index === -1 ? CATEGORY_ORDER.length : index;
  };
  return groups.sort((a, b) => rank(a.value) - rank(b.value));
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

/** Series and their sets as in the sets list, keeping those whose name contains `query`. */
export function setGroups(
  groups: readonly SeriesGroup[],
  language: CatalogLanguage,
  query: string
): FilterGroup[] {
  const needle = normalizeSearchText(query);
  return groups.flatMap((group) => {
    const seriesMatches = normalizeSearchText(group.name).includes(needle);
    const options = group.sets
      .map((set) => ({
        value: `${set.region}:${set.id}`,
        label: localized(set.names, language),
        set,
      }))
      .filter((option) => seriesMatches || normalizeSearchText(option.label).includes(needle));
    return options.length > 0 ? [{ value: group.key, label: group.name, options }] : [];
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
