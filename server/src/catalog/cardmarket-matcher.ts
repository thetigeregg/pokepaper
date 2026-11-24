import type {
  CardmarketCandidate,
  CardmarketCandidates,
  CatalogCard,
  CatalogRegion,
} from '@pokepaper/shared';
import type { CatalogLogger } from './ingest.js';
import { isProductId, parseGuideEntry, toWirePrices } from './price-data.js';
import { readCapped, repriceCard, type CardmarketMatchSource } from './prices.js';
import {
  cardmarketSearchText,
  type CardmarketProduct,
  type CardmarketProductFilter,
  type CatalogStore,
} from './store.js';

/** Cardmarket's product list for Pokémon (game 6), single cards only: regenerated daily. */
export const CARDMARKET_PRODUCTS_URL =
  'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json';
const FETCH_TIMEOUT_MS = 120_000;
/** The list is about 14 MB; anything far larger isn't it. */
const MAX_PRODUCTS_BYTES = 128 * 1024 * 1024;
/** The stored list is checked for a newer one (with its ETag) once it's this old. */
export const PRODUCTS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** At most this many candidates per answer (`truncated` beyond). */
export const MAX_CANDIDATES = 50;
/** Searches shorter than this (after `cardmarketSearchText`) get the suggestions instead. */
export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 100;

/** Writes to `cardmarket_matches` (`CardmarketMatchStore`). */
export interface CardmarketMatchWriter extends CardmarketMatchSource {
  save(region: CatalogRegion, cardId: string, idProduct: number): void;
  remove(region: CatalogRegion, cardId: string): boolean;
}

export interface CardmarketMatcherOptions {
  store: CatalogStore;
  matches: CardmarketMatchWriter;
  log: CatalogLogger;
  /** Injected in tests. */
  fetch?: typeof fetch;
  now?: () => Date;
}

/** Cardmarket's product list couldn't be downloaded, and none is stored. */
export class CardmarketProductsUnavailableError extends Error {}

type Json = Record<string, unknown>;

/**
 * Matching cards to Cardmarket products by hand (docs/catalog.md → Matching
 * by hand): candidates from Cardmarket's product list (downloaded when
 * needed, at most daily), matches stored in `cardmarket_matches`, and the
 * matched card priced at once from the stored price guide.
 */
export class CardmarketMatcher {
  private readonly now: () => Date;
  private refreshing: Promise<void> | null = null;

  constructor(private readonly options: CardmarketMatcherOptions) {
    this.now = options.now ?? ((): Date => new Date());
  }

  /**
   * Products a card could be matched to, or undefined for an unknown card.
   * `query` is searched in product names; without it (or shorter than
   * `MIN_QUERY_LENGTH`), products named like the card are offered. Throws
   * `CardmarketProductsUnavailableError`.
   */
  async candidates(
    region: CatalogRegion,
    cardId: string,
    query?: string
  ): Promise<CardmarketCandidates | undefined> {
    const { store, matches } = this.options;
    const card = store.getCard(region, cardId);
    if (!card) {
      return undefined;
    }
    await this.ensureProducts();
    const expansions = store.listSetExpansions(region, card.setId);
    const search = query === undefined ? '' : cardmarketSearchText(query);
    const found =
      search.length >= MIN_QUERY_LENGTH
        ? store.findCardmarketProducts({ contains: search, prefer: expansions }, MAX_CANDIDATES + 1)
        : this.suggestions(card, expansions);

    const byHand = matches.get(region, cardId);
    const current = byHand ?? store.getCardmarketProductOf(region, cardId);
    const guide = store.getPriceGuideState();
    const entries = store.getPriceGuideEntries(found.map((product) => product.idProduct));
    const products = found.slice(0, MAX_CANDIDATES).map((product): CardmarketCandidate => ({
      idProduct: product.idProduct,
      name: product.name,
      added: product.dateAdded,
      inSet: product.inSet,
      prices: wirePrices(entries.get(product.idProduct), guide?.createdAt),
    }));
    return {
      current:
        current === undefined
          ? null
          : {
              idProduct: current,
              matchedByHand: byHand !== undefined,
              name: store.getCardmarketProduct(current)?.name ?? null,
            },
      products,
      truncated: found.length > MAX_CANDIDATES,
    };
  }

  /**
   * Matches a card to a product and prices it from the stored guide.
   * `unknown_card` / `unknown_product`: not in the catalog / Cardmarket's
   * product list. Throws `CardmarketProductsUnavailableError`.
   */
  async match(
    region: CatalogRegion,
    cardId: string,
    idProduct: number
  ): Promise<'ok' | 'unknown_card' | 'unknown_product'> {
    const { store, matches } = this.options;
    if (!store.getCard(region, cardId)) {
      return 'unknown_card';
    }
    await this.ensureProducts();
    if (!store.getCardmarketProduct(idProduct)) {
      return 'unknown_product';
    }
    matches.save(region, cardId, idProduct);
    repriceCard(store, matches, region, cardId);
    this.options.log.info({ region, cardId, idProduct }, 'catalog.cardmarket_matched');
    return 'ok';
  }

  /**
   * Forgets a card's match, pricing it by TCGdex's product again (or not at
   * all). False for an unknown card.
   */
  clear(region: CatalogRegion, cardId: string): boolean {
    const { store, matches } = this.options;
    if (!store.getCard(region, cardId)) {
      return false;
    }
    if (matches.remove(region, cardId)) {
      repriceCard(store, matches, region, cardId);
      this.options.log.info({ region, cardId }, 'catalog.cardmarket_match_cleared');
    }
    return true;
  }

  /**
   * Products named like the card (in any of its languages) in its set's
   * expansions; else with that name anywhere; else the whole expansion.
   * Named ones are narrowed to those sharing an attack or ability with the
   * card (Cardmarket names them in brackets), when any do: Cardmarket tells
   * apart same-named cards of a set that way (two M Mewtwo EX in
   * BREAKthrough).
   */
  private suggestions(
    card: CatalogCard,
    expansions: readonly number[]
  ): (CardmarketProduct & { inSet: boolean })[] {
    const { store } = this.options;
    const texts = Object.values(card.text);
    const names = searchTexts(texts.map((text) => text.name));
    const moves = new Set(
      searchTexts(
        texts.flatMap((text) => [
          ...text.attacks.map((attack) => attack.name),
          ...text.abilities.map((ability) => ability.name),
        ])
      )
    );
    const sharesMove = (product: CardmarketProduct): boolean =>
      bracketedMoves(product.name).some((move) => moves.has(move));
    const attempts: { filter: CardmarketProductFilter; named: boolean }[] = [
      ...(expansions.length > 0
        ? [{ filter: { matchNames: names, expansions, prefer: expansions }, named: true }]
        : []),
      { filter: { matchNames: names, prefer: expansions }, named: true },
      ...(expansions.length > 0
        ? [{ filter: { expansions, prefer: expansions }, named: false }]
        : []),
    ];
    for (const { filter, named } of attempts) {
      const found = store.findCardmarketProducts(filter, MAX_CANDIDATES + 1);
      const narrowed = named ? found.filter(sharesMove) : [];
      if (narrowed.length > 0) {
        return narrowed;
      }
      if (found.length > 0) {
        return found;
      }
    }
    return [];
  }

  /**
   * Makes sure a product list is stored, checking for a newer one once the
   * stored one is `PRODUCTS_MAX_AGE_MS` old. Concurrent calls share one
   * download. A failed check keeps the stored list (logged); with none
   * stored, throws `CardmarketProductsUnavailableError`.
   */
  private async ensureProducts(): Promise<void> {
    const state = this.options.store.getCardmarketProductsState();
    if (state && this.now().getTime() - Date.parse(state.checkedAt) < PRODUCTS_MAX_AGE_MS) {
      return;
    }
    this.refreshing ??= this.refreshProducts().finally(() => {
      this.refreshing = null;
    });
    try {
      await this.refreshing;
    } catch (error: unknown) {
      this.options.log.warn({ err: error }, 'catalog.cardmarket_products_failed');
      if (!state) {
        throw new CardmarketProductsUnavailableError('Cardmarket product list unavailable', {
          cause: error,
        });
      }
    }
  }

  private async refreshProducts(): Promise<void> {
    const { store, log } = this.options;
    const fetchFn = this.options.fetch ?? fetch;
    const previous = store.getCardmarketProductsState();
    const response = await fetchFn(CARDMARKET_PRODUCTS_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: previous?.etag ? { 'If-None-Match': previous.etag } : {},
    });
    const checkedAt = this.now().toISOString();
    if (response.status === 304 && previous?.etag) {
      store.saveCardmarketProductsState({ ...previous, checkedAt });
      return;
    }
    if (!response.ok) {
      throw new Error(`Cardmarket product list: HTTP ${String(response.status)}`);
    }
    const list = parseProductList(
      JSON.parse(await readCapped(response, MAX_PRODUCTS_BYTES, 'Cardmarket product list'))
    );
    if (!list) {
      throw new Error('Cardmarket product list: unexpected content');
    }
    store.replaceCardmarketProducts(list.products, {
      etag: response.headers.get('etag'),
      createdAt: list.createdAt,
      checkedAt,
    });
    log.info({ products: list.products.length }, 'catalog.cardmarket_products_stored');
  }
}

/** `cardmarketSearchText` of each, without empty and repeated ones. */
function searchTexts(values: readonly string[]): string[] {
  return [
    ...new Set(
      values.map((value) => cardmarketSearchText(value)).filter((text) => text.length > 0)
    ),
  ];
}

/** The attacks and abilities in a product name's brackets: `[Mirror Move | Feather Lance]`. */
function bracketedMoves(name: string): string[] {
  const brackets = /\[([^\]]*)\]/.exec(name);
  return brackets ? searchTexts(brackets[1].split('|')) : [];
}

function wirePrices(entry: unknown, updated: string | undefined): CardmarketCandidate['prices'] {
  const stored = entry === undefined || !updated ? null : parseGuideEntry(entry, updated);
  if (!stored) {
    return null;
  }
  const wire = toWirePrices(stored);
  return wire.base || wire.reverseHolo ? wire : null;
}

/**
 * `{ createdAt, products: [{ idProduct, name, idExpansion, dateAdded, … }] }`,
 * or null when it isn't that (or holds no usable product).
 */
export function parseProductList(
  value: unknown
): { createdAt: string; products: CardmarketProduct[] } | null {
  if (!isObject(value) || !Array.isArray(value['products'])) {
    return null;
  }
  const createdAt =
    typeof value['createdAt'] === 'string' ? Date.parse(value['createdAt']) : Number.NaN;
  if (Number.isNaN(createdAt)) {
    return null;
  }
  const products: CardmarketProduct[] = [];
  for (const entry of value['products'] as unknown[]) {
    if (
      isObject(entry) &&
      isProductId(entry['idProduct']) &&
      typeof entry['name'] === 'string' &&
      entry['name'].length > 0 &&
      typeof entry['idExpansion'] === 'number' &&
      Number.isSafeInteger(entry['idExpansion'])
    ) {
      products.push({
        idProduct: entry['idProduct'],
        name: entry['name'],
        idExpansion: entry['idExpansion'],
        dateAdded: parseDateAdded(entry['dateAdded']),
      });
    }
  }
  return products.length > 0 ? { createdAt: new Date(createdAt).toISOString(), products } : null;
}

/** `2015-11-12 15:08:09` → `2015-11-12`; Cardmarket's `0000-00-00 …` (unknown) → null. */
function parseDateAdded(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return date && date[1] !== '0000' ? `${date[1]}-${date[2]}-${date[3]}` : null;
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
