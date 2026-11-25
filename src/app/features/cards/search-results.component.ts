import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import {
  IonCol,
  IonGrid,
  IonIcon,
  IonInfiniteScroll,
  IonInfiniteScrollContent,
  IonItem,
  IonItemDivider,
  IonItemGroup,
  IonLabel,
  IonList,
  IonListHeader,
  IonRow,
  IonText,
  ModalController,
  type InfiniteScrollCustomEvent,
} from '@ionic/angular';
import type { CatalogCard, CatalogLanguage, CatalogSet } from '@pokepaper/shared';
import { addIcons } from 'ionicons';
import { timeOutline } from 'ionicons/icons';
import { StorageEngineFactory } from '../../core/data/storage-engine.factory';
import { localized } from '../../core/services/catalog-browse.service';
import { CatalogLanguageService } from '../../core/services/catalog-language.service';
import { CatalogSearchService } from '../../core/services/catalog-search.service';
import { LayoutService } from '../../core/services/layout.service';
import { CardDetailComponent } from './card-detail.component';
import { cardText, setLine } from './card-display';
import { CardTileComponent } from './card-tile.component';
import { SetSymbolComponent } from './set-symbol.component';

/** Cards loaded per page as the results scroll. */
export const RESULTS_PAGE_SIZE = 60;

/**
 * Makes results pick cards instead of opening them (a deck's Add cards):
 * tapping a card calls `pick`, its tile shows `count`, and its info button
 * opens it.
 */
export interface CardPicker {
  count(card: CatalogCard): number;
  pick(card: CatalogCard): void;
}

interface LoadedCard {
  key: string;
  setKey: string;
  card: CatalogCard;
}

interface ResultGroup {
  setKey: string;
  set: CatalogSet | null;
  name: string;
  /** Matching cards in the set (not just those loaded). */
  count: number;
  language: CatalogLanguage;
  cards: { card: CatalogCard; index: number }[];
}

/**
 * Search results (docs/ui.md → Cards → Search): recent searches until there's
 * a query or filter, then the matching cards grouped by set under sticky
 * IonItemDividers, newest set first, loading more as they scroll. A card
 * opens in the card modal, paging through the results.
 */
@Component({
  selector: 'app-search-results',
  templateUrl: 'search-results.component.html',
  styles: [
    `
      .summary {
        margin: 12px 16px 4px;
        font-size: 0.875rem;
      }
    `,
  ],
  imports: [
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonIcon,
    IonText,
    IonItemGroup,
    IonItemDivider,
    IonGrid,
    IonRow,
    IonCol,
    IonInfiniteScroll,
    IonInfiniteScrollContent,
    CardTileComponent,
    SetSymbolComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchResultsComponent {
  readonly search = inject(CatalogSearchService);
  private readonly storageEngineFactory = inject(StorageEngineFactory);
  private readonly catalogLanguage = inject(CatalogLanguageService);
  private readonly modals = inject(ModalController);
  private readonly layout = inject(LayoutService);

  /** Set by a deck's Add cards: tapping a card picks it (see `CardPicker`). */
  readonly picker = input<CardPicker | null>(null);

  readonly loaded = signal<LoadedCard[]>([]);
  /**
   * How far into the results pages have been read. It moves by whole pages,
   * not by the cards that loaded, so a card missing from storage (a set
   * replaced since the results were worked out) doesn't shift later pages.
   */
  private readonly next = signal(0);
  readonly total = computed(() => this.search.results().cards.length);
  readonly allLoaded = computed(() => this.next() >= this.total());
  readonly summary = computed(() => {
    const cards = this.total();
    const sets = this.search.results().perSet.size;
    return `${plural(cards, 'card')} in ${plural(sets, 'set')}`;
  });

  readonly groups = computed<ResultGroup[]>(() => {
    const sets = this.search.sets();
    const perSet = this.search.results().perSet;
    const language = this.search.language();
    const groups: ResultGroup[] = [];
    this.loaded().forEach(({ setKey, card }, index) => {
      let group = groups.at(-1);
      if (group?.setKey !== setKey) {
        const set = sets.get(setKey)?.set ?? null;
        group = {
          setKey,
          set,
          name: set ? localized(set.names, language) : card.setId,
          count: perSet.get(setKey) ?? 0,
          language: this.catalogLanguage.forSet(card.region, set?.languages ?? []),
          cards: [],
        };
        groups.push(group);
      }
      group.cards.push({ card, index });
    });
    return groups;
  });

  /** Bumped when the results change, so a page loading for older results is dropped. */
  private generation = 0;
  private loading: Promise<void> | null = null;
  /** The keys of the results last shown, to tell a real change from a recompute. */
  private shownKeys: readonly string[] = [];

  constructor() {
    addIcons({ timeOutline });
    effect(() => {
      const keys = this.search.results().cards.map((card) => card.key);
      untracked(() => {
        // The same results recomputed (e.g. the index reloaded after a
        // catalog sync): keep what's loaded and where the user scrolled.
        if (sameKeys(keys, this.shownKeys)) {
          return;
        }
        this.shownKeys = keys;
        this.generation++;
        this.loading = null;
        this.loaded.set([]);
        this.next.set(0);
        void this.loadMore();
      });
    });
  }

  async more(event: InfiniteScrollCustomEvent): Promise<void> {
    await this.loadMore();
    await event.target.complete();
  }

  /** Loads the next page of matching cards (one page at a time). */
  loadMore(): Promise<void> {
    if (!this.loading) {
      const loading = this.loadPage().finally(() => {
        // Only its own: a page for newer results may have started since.
        if (this.loading === loading) {
          this.loading = null;
        }
      });
      this.loading = loading;
    }
    return this.loading;
  }

  private async loadPage(): Promise<void> {
    const generation = this.generation;
    const start = this.next();
    const page = this.search.results().cards.slice(start, start + RESULTS_PAGE_SIZE);
    if (page.length === 0) {
      return;
    }
    try {
      const cards = await this.storageEngineFactory
        .getEngine()
        .getCatalogCardsByKey(page.map(({ key }) => key));
      if (generation !== this.generation) {
        return;
      }
      const byKey = new Map(cards.map((card) => [`${card.region}:${card.id}`, card]));
      this.next.set(start + page.length);
      this.loaded.update((loaded) => [
        ...loaded,
        ...page.flatMap(({ key, setKey }) => {
          const card = byKey.get(key);
          return card ? [{ key, setKey, card }] : [];
        }),
      ]);
    } catch (error: unknown) {
      console.error('catalog.search_page_failed', error);
    }
  }

  name(card: CatalogCard, language: CatalogLanguage): string {
    return cardText(card, language)?.name ?? card.id;
  }

  line(group: ResultGroup, card: CatalogCard): string {
    return group.set ? setLine(group.set, card) : card.localId;
  }

  /** A tapped card: picked when there's a picker, else opened. */
  tap(card: CatalogCard, index: number): void {
    const picker = this.picker();
    if (picker) {
      void this.search.rememberQuery();
      picker.pick(card);
    } else {
      void this.openCard(index);
    }
  }

  pickRecent(query: string): void {
    this.search.setQuery(query);
    void this.search.rememberQuery();
  }

  async openCard(index: number): Promise<void> {
    void this.search.rememberQuery();
    const sets = new Map([...this.search.sets()].map(([key, entry]) => [key, entry.set] as const));
    // A sheet on phones, a centered dialog on desktop (docs/ui.md).
    const sheet = !this.layout.wide();
    const modal = await this.modals.create({
      component: CardDetailComponent,
      componentProps: {
        setsProp: sets,
        cardsProp: this.loaded().map(({ card }) => card),
        startIndex: index,
        // Paging past the loaded cards loads the next page of results.
        loadMoreProp: async () => {
          await this.loadMore();
          return this.loaded().map(({ card }) => card);
        },
      },
      cssClass: 'card-detail-modal',
      ...(sheet ? { breakpoints: [0, 1], initialBreakpoint: 1, handle: true } : {}),
    });
    await modal.present();
  }
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

function plural(count: number, noun: string): string {
  return `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`;
}
