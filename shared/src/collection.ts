import type { CatalogVariants } from './catalog';

/**
 * Collection tracking (docs/collection.md): how many copies of a card the
 * user owns, per variant and language. Synced as one entity per
 * card + variant + language (`entityType: 'collectionEntry'`, entity ID from
 * `collectionEntryId`). A quantity of 0 is never stored: the entry is
 * deleted instead.
 */

/** Variants the app offers, in display order: the keys of TCGdex's `variants` flags. */
export const COLLECTION_VARIANTS = [
  'normal',
  'reverse',
  'holo',
  'firstEdition',
  'wPromo',
] as const satisfies readonly (keyof CatalogVariants)[];
export type CollectionVariant = (typeof COLLECTION_VARIANTS)[number];

export function isCollectionVariant(value: unknown): value is CollectionVariant {
  return typeof value === 'string' && (COLLECTION_VARIANTS as readonly string[]).includes(value);
}

/**
 * Copies of one card in one variant and language. `region`, `variant` and
 * `language` are plain strings on the wire: a newer client may know values
 * this one doesn't, and those entries still sync (the app ignores them).
 */
export interface CollectionEntry {
  region: string;
  cardId: string;
  /** The card's set, so set progress needs no catalog lookup. */
  setId: string;
  variant: string;
  language: string;
  /** 1 to `MAX_COLLECTION_QUANTITY`. */
  quantity: number;
}

/** What a collection entry counts: everything but the quantity. */
export type CollectionTarget = Omit<CollectionEntry, 'quantity'>;

/** A new quantity for one target (0 removes it), for writing several at once. */
export interface CollectionChange {
  target: CollectionTarget;
  quantity: number;
}

export const MAX_COLLECTION_QUANTITY = 999;

/** Bounds for the short fields (`region`, `variant`, `language`). */
const MAX_TAG_LENGTH = 16;
/** Bounds for catalog IDs (`cardId`, `setId`). */
const MAX_ID_LENGTH = 64;

/**
 * The entry's sync entity ID and local key: `region:cardId:variant:language`.
 * `region`, `variant` and `language` never contain `:` (`isCollectionEntry`),
 * so the ID is unambiguous even if a card ID did.
 */
export function collectionEntryId(target: CollectionTarget): string {
  return `${target.region}:${target.cardId}:${target.variant}:${target.language}`;
}

/** Whether `entityId` has the shape `collectionEntryId` produces (used for deletes). */
export function isCollectionEntryId(entityId: string): boolean {
  const parts = entityId.split(':');
  if (parts.length < 4) {
    return false;
  }
  const region = parts[0] ?? '';
  const language = parts.at(-1) ?? '';
  const variant = parts.at(-2) ?? '';
  const cardId = parts.slice(1, -2).join(':');
  return isTag(region) && isTag(variant) && isTag(language) && isId(cardId);
}

/** The entry for `target` with `quantity`, carrying only entry fields. */
export function collectionEntry(target: CollectionTarget, quantity: number): CollectionEntry {
  return {
    region: target.region,
    cardId: target.cardId,
    setId: target.setId,
    variant: target.variant,
    language: target.language,
    quantity,
  };
}

/** Whether `quantity` can be set: a whole number from 0 (removes the entry) to `MAX_COLLECTION_QUANTITY`. */
export function isCollectionQuantity(quantity: unknown): quantity is number {
  return (
    typeof quantity === 'number' &&
    Number.isInteger(quantity) &&
    quantity >= 0 &&
    quantity <= MAX_COLLECTION_QUANTITY
  );
}

/** Whether `value` has valid entry fields (everything but the quantity). */
export function isCollectionTarget(value: unknown): value is CollectionTarget {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const { region, cardId, setId, variant, language } = value as Record<string, unknown>;
  return isTag(region) && isId(cardId) && isId(setId) && isTag(variant) && isTag(language);
}

/** Runtime shape check for collection entry payloads (used by the server to validate pushes). */
export function isCollectionEntry(value: unknown): value is CollectionEntry {
  if (!isCollectionTarget(value)) {
    return false;
  }
  const { quantity } = value as unknown as Record<string, unknown>;
  return isCollectionQuantity(quantity) && quantity >= 1;
}

function isTag(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_TAG_LENGTH &&
    !value.includes(':')
  );
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
}
