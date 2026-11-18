import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
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

/** Cards loaded per page as the results scroll. */
export const RESULTS_PAGE_SIZE = 60;

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
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchResultsComponent {
  readonly search = inject(CatalogSearchService);
  private readonly storageEngineFactory = inject(StorageEngineFactory);
  private readonly catalogLanguage = inject(CatalogLanguageService);
  private readonly modals = inject(ModalController);
  private readonly layout = inject(LayoutService);

  readonly loaded = signal<LoadedCard[]>([]);
  readonly total = computed(() => this.search.results().cards.length);
  readonly allLoaded = computed(() => this.loaded().length >= this.total());
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

  constructor() {
    addIcons({ timeOutline });
    effect(() => {
      this.search.results();
      untracked(() => {
        this.generation++;
        this.loading = null;
        this.loaded.set([]);
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
    this.loading ??= this.loadPage().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async loadPage(): Promise<void> {
    const generation = this.generation;
    const start = this.loaded().length;
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
      },
      cssClass: 'card-detail-modal',
      ...(sheet ? { breakpoints: [0, 1], initialBreakpoint: 1, handle: true } : {}),
    });
    await modal.present();
  }
}

function plural(count: number, noun: string): string {
  return `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`;
}
