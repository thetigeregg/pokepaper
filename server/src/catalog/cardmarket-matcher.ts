import {
  MAX_CARDMARKET_QUERY_LENGTH,
  type CardmarketCandidate,
  type CardmarketCandidates,
  type CatalogCard,
  type CatalogRegion,
} from '@pokepaper/shared';
import { cardmarketProductsDue, downloadCardmarketProducts } from './cardmarket-products.js';
import type { CatalogLogger } from './ingest.js';
import { parseGuideEntry, toWirePrices } from './price-data.js';
import { productLinkChecker, repriceCard, type CardmarketMatchSource } from './prices.js';
import {
  cardmarketSearchText,
  type CardmarketProduct,
  type CardmarketProductFilter,
  type CatalogStore,
} from './store.js';

export { PRODUCTS_RETRY_MS } from './cardmarket-products.js';
/** At most this many candidates per answer (`truncated` beyond). */
export const MAX_CANDIDATES = 50;
/** Searches shorter than this (after `cardmarketSearchText`) get the suggestions instead. */
export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = MAX_CARDMARKET_QUERY_LENGTH;

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
    const linked = store.getCardmarketProductOf(region, cardId);
    // TCGdex's product isn't offered as the card's when it's another card's.
    const tcgdex =
      linked !== undefined && !productLinkChecker(store, this.now())(region, cardId, linked)
        ? linked
        : undefined;
    const current = byHand ?? tcgdex;
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
      tcgdex:
        tcgdex === undefined
          ? null
          : { idProduct: tcgdex, name: store.getCardmarketProduct(tcgdex)?.name ?? null },
      products,
      truncated: found.length > MAX_CANDIDATES,
      searched: search.length >= MIN_QUERY_LENGTH,
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
    repriceCard(store, matches, region, cardId, this.now());
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
      repriceCard(store, matches, region, cardId, this.now());
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

  /** Resolves once a check of the product list in progress has finished (tests). */
  async settled(): Promise<void> {
    await this.refreshing?.catch(() => undefined);
  }

  /**
   * Makes sure a product list is stored. With none stored, waits for the
   * download, throwing `CardmarketProductsUnavailableError` if it fails.
   * Once the stored one is `PRODUCTS_MAX_AGE_MS` old, it's checked for a
   * newer one in the background, so answers never wait on Cardmarket; after
   * a failed check, not again for `PRODUCTS_RETRY_MS`.
   */
  private async ensureProducts(): Promise<void> {
    const state = this.options.store.getCardmarketProductsState();
    if (!state) {
      try {
        await this.refresh();
      } catch (error: unknown) {
        throw new CardmarketProductsUnavailableError('Cardmarket product list unavailable', {
          cause: error,
        });
      }
      return;
    }
    if (cardmarketProductsDue(this.options.store, this.now())) {
      this.refresh().catch(() => undefined); // Logged in refresh().
    }
  }

  /** Downloads the product list; concurrent calls share one download. Failures are logged. */
  private refresh(): Promise<void> {
    this.refreshing ??= this.refreshProducts()
      .catch((error: unknown) => {
        this.options.log.warn({ err: error }, 'catalog.cardmarket_products_failed');
        throw error;
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  private refreshProducts(): Promise<void> {
    const { store, log, fetch } = this.options;
    return downloadCardmarketProducts({ store, log, fetch, now: this.now });
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
