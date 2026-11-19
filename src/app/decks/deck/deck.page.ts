import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonText,
  IonTitle,
  IonToggle,
  IonToolbar,
  ModalController,
  NavController,
} from '@ionic/angular';
import {
  CATALOG_REGIONS,
  DECK_FORMATS,
  MAX_DECK_CARD_COUNT,
  deckCardKey,
  isDeckFormat,
  type CatalogCard,
  type CatalogLanguage,
  type CatalogRegion,
  type CatalogSet,
  type DeckCard,
} from '@pokepaper/shared';
import { addIcons } from 'ionicons';
import {
  addCircleOutline,
  addOutline,
  checkmarkCircleOutline,
  createOutline,
  removeCircleOutline,
  trashOutline,
  warningOutline,
} from 'ionicons/icons';
import { debounceTime } from 'rxjs';
import { catalogKey, type StorageEngine } from '../../core/data/storage-engine';
import { StorageEngineFactory } from '../../core/data/storage-engine.factory';
import { CatalogLanguageService } from '../../core/services/catalog-language.service';
import { CatalogSyncService } from '../../core/services/catalog-sync.service';
import { DeckChecksService } from '../../features/decks/deck-checks.service';
import type { DeckOwned } from '../../features/decks/deck-owned';
import { DeckService } from '../../core/services/deck.service';
import { LayoutService } from '../../core/services/layout.service';
import { CardDetailComponent } from '../../features/cards/card-detail.component';
import { cardText, setLine } from '../../features/cards/card-display';
import { CardImageComponent } from '../../features/cards/card-image.component';
import {
  HeaderActionsComponent,
  type HeaderAction,
} from '../../features/common/header-actions.component';
import { DeckDialogsService } from '../../features/decks/deck-dialogs.service';
import { DECK_FORMAT_LABELS, deckCardTotal, deckFormat } from '../../features/decks/deck-display';
import { AddCardsComponent } from '../add-cards/add-cards.component';

/** Section a deck's cards are listed under, in display order. */
type SectionId = 'Pokemon' | 'Trainer' | 'Energy' | 'other' | 'missing';

const SECTION_TITLES: Record<SectionId, string> = {
  Pokemon: 'Pokémon',
  Trainer: 'Trainer',
  Energy: 'Energy',
  other: 'Other',
  missing: 'Not on this device',
};

/** The missing section's title when the catalog couldn't be read (they may be there). */
const UNREAD_TITLE = "Couldn't be read";

const SECTION_ORDER: readonly SectionId[] = ['Pokemon', 'Trainer', 'Energy', 'other', 'missing'];

/** A card in the deck, with what its row shows. */
export interface DeckRow {
  key: string;
  slot: DeckCard;
  /** Null when the card isn't in the catalog on this device. */
  card: CatalogCard | null;
  language: CatalogLanguage;
  name: string;
  /** "OBF · 125/197", or the card ID without its set. */
  line: string;
}

export interface DeckSection {
  id: SectionId;
  title: string;
  /** Copies in the section. */
  count: number;
  rows: DeckRow[];
}

function isCatalogRegion(value: string): value is CatalogRegion {
  return (CATALOG_REGIONS as readonly string[]).includes(value);
}

/**
 * One deck (docs/ui.md → Decks): its format and card total, then its cards
 * by category with a stepper each. The header adds cards (the Add cards
 * modal) and renames or deletes the deck.
 */
@Component({
  selector: 'app-deck',
  templateUrl: 'deck.page.html',
  styles: [
    `
      /* The row's scan, name and number: one button (role) that opens the card. */
      .open-card {
        cursor: pointer;
      }
      /* The card's scan, leading the row like the checklist's. */
      .thumb {
        width: 52px;
      }
      /* − count +, the count wide enough for two digits so the buttons don't move. */
      .stepper {
        display: flex;
        align-items: center;
      }
      /* A rule the card breaks, under its set and number. */
      .rule-note {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .rule-note ion-icon,
      .rule ion-icon {
        flex-shrink: 0;
      }
      /* Owned vs. needed under the card's set and number. */
      .owned-line {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .owned-line.short {
        color: var(--ion-color-danger);
      }
      .count {
        min-width: 2.5ch;
        font-variant-numeric: tabular-nums;
        text-align: center;
      }
      @media (min-width: 992px) {
        .stepper ion-icon {
          font-size: 28px;
        }
        .count {
          font-size: 1.15rem;
        }
      }
    `,
  ],
  imports: [
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonButton,
    IonIcon,
    IonTitle,
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
    IonSelect,
    IonSelectOption,
    IonText,
    IonToggle,
    CardImageComponent,
    HeaderActionsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckPage {
  private readonly decks = inject(DeckService);
  private readonly checks = inject(DeckChecksService);
  private readonly dialogs = inject(DeckDialogsService);
  private readonly storageEngineFactory = inject(StorageEngineFactory);
  private readonly catalogLanguage = inject(CatalogLanguageService);
  private readonly modals = inject(ModalController);
  private readonly nav = inject(NavController);
  private readonly layout = inject(LayoutService);

  /** Route parameter (component input binding). */
  readonly id = input.required<string>();

  readonly loaded = this.decks.loaded;
  readonly deck = computed(() => this.decks.deck(this.id()));
  readonly formats = DECK_FORMATS.map((format) => ({
    value: format,
    label: DECK_FORMAT_LABELS[format],
  }));
  readonly format = computed(() => {
    const deck = this.deck();
    return deck ? deckFormat(deck) : 'standard';
  });
  readonly total = computed(() => {
    const deck = this.deck();
    return deck ? deckCardTotal(deck) : 0;
  });
  /** The deck checked against its format, once its cards have been looked up. */
  readonly check = computed(() => this.checks.check(this.id()));
  /** What the collection covers of the deck, once known (docs/decks.md → Owned vs. needed). */
  /**
   * The last known result: while a card just added is looked up, the
   * service has none, and the page keeps showing the previous one.
   */
  readonly owned = linkedSignal<DeckOwned | undefined, DeckOwned | undefined>({
    source: () => this.checks.ownedOf(this.id()),
    computation: (next, previous) => next ?? previous?.value,
  });
  /** Copies still needed, or that can't be checked (not on this device). */
  readonly toFind = computed(() => {
    const owned = this.owned();
    return owned ? owned.missing + owned.unknown : 0;
  });
  /** Show only the cards still needed (a shopping list). */
  readonly missingOnly = signal(false);
  /**
   * Rows shown in missing-only mode besides those still short: the ones
   * short when it was turned on, so a row doesn't vanish mid-tap.
   */
  private readonly listed = signal<ReadonlySet<string>>(new Set());
  /**
   * The sections shown: every card, or (missing only) the cards still
   * needed or not on this device, counted by copies still needed.
   */
  readonly shownSections = computed<DeckSection[]>(() => {
    const owned = this.owned();
    if (!this.missingOnly() || !owned) {
      return this.sections();
    }
    const listed = this.listed();
    const toFind = (row: DeckRow) => {
      const slot = owned.slots.get(row.key);
      return slot ? slot.missing : row.slot.count; // Not on this device: can't tell.
    };
    return this.sections().flatMap((section) => {
      const rows = section.rows.filter((row) => toFind(row) > 0 || listed.has(row.key));
      const count = rows.reduce((total, row) => total + toFind(row), 0);
      return rows.length > 0 ? [{ ...section, rows, count }] : [];
    });
  });
  readonly rulesTitle = computed(() => `${DECK_FORMAT_LABELS[this.format()]} rules`);

  /**
   * The deck's cards and their sets, from the catalog on this device, and
   * which printings that read looked for: one it looked for and didn't find
   * isn't on this device; one added since is still being read.
   */
  private readonly catalog = signal<{
    keys: ReadonlySet<string>;
    cards: ReadonlyMap<string, CatalogCard>;
    sets: ReadonlyMap<string, CatalogSet>;
  }>({ keys: new Set(), cards: new Map(), sets: new Map() });
  /** The last catalog read failed: cards it didn't find are listed by ID, with Try again. */
  readonly readFailed = signal(false);
  /** The page is going back after deleting its deck: don't say the deck is missing. */
  readonly deleting = signal(false);

  /** The printings in the deck, as one string: changes when cards are added or removed. */
  private readonly cardKeys = computed(() => (this.deck()?.cards ?? []).map(deckCardKey));
  private readonly cardKeysJoined = computed(() => this.cardKeys().join('\n'));

  readonly sections = computed<DeckSection[]>(() => {
    const deck = this.deck();
    if (!deck) {
      return [];
    }
    const { keys, cards, sets } = this.catalog();
    const sections = new Map<SectionId, DeckSection>();
    for (const slot of deck.cards) {
      const key = deckCardKey(slot);
      const card = cards.get(key) ?? null;
      // Not read yet (just added): listed once it has been.
      if (!card && !keys.has(key)) {
        continue;
      }
      const id = sectionOf(card);
      const set = card ? (sets.get(catalogKey(card.region, card.setId)) ?? null) : null;
      const language = card
        ? this.catalogLanguage.forSet(card.region, set?.languages ?? [])
        : this.fallbackLanguage(slot.region);
      let section = sections.get(id);
      if (!section) {
        const title = id === 'missing' && this.readFailed() ? UNREAD_TITLE : SECTION_TITLES[id];
        section = { id, title, count: 0, rows: [] };
        sections.set(id, section);
      }
      section.count += slot.count;
      section.rows.push({
        key,
        slot,
        card,
        language,
        name: card ? (cardText(card, language)?.name ?? card.id) : slot.cardId,
        line: card && set ? setLine(set, card) : slot.cardId,
      });
    }
    return SECTION_ORDER.flatMap((id) => {
      const section = sections.get(id);
      return section ? [section] : [];
    });
  });

  /** The header's actions after Add cards (in a More menu on phones). */
  readonly actions = computed<HeaderAction[]>(() => [
    {
      id: 'rename',
      label: 'Rename deck',
      icon: 'create-outline',
      disabled: !this.deck(),
      run: () => void this.rename(),
    },
    {
      id: 'delete',
      label: 'Delete deck',
      icon: 'trash-outline',
      disabled: !this.deck(),
      run: () => void this.delete(),
    },
  ]);

  /** Stepper taps, applied in order (see `step`). */
  private steps: Promise<void> = Promise.resolve();

  /**
   * One step from the deck as it is now. Returns once the change shows (the
   * deck service applies it at once), with its save still running.
   */
  private async applyStep(row: DeckRow, delta: 1 | -1): Promise<{ saving: Promise<void> } | null> {
    const count = this.deck()?.cards.find((slot) => deckCardKey(slot) === row.key)?.count ?? 0;
    if (count + delta < 0) {
      return null;
    }
    if (delta > 0 && row.card) {
      const limit = await this.checks.copyLimit(this.id(), row.card);
      if (limit.total >= limit.limit) {
        void this.dialogs.showCopyLimit(limit);
        return null;
      }
    }
    const card = { region: row.slot.region, cardId: row.slot.cardId };
    return { saving: this.decks.setCardCount(this.id(), card, count + delta) };
  }

  /** Bumped by each catalog read, so an older one finishing late is dropped. */
  private reads = 0;

  private get engine(): StorageEngine {
    return this.storageEngineFactory.getEngine();
  }

  constructor() {
    addIcons({
      addOutline,
      addCircleOutline,
      removeCircleOutline,
      createOutline,
      trashOutline,
      warningOutline,
      checkmarkCircleOutline,
    });
    effect(() => {
      this.cardKeysJoined();
      untracked(() => void this.loadCards());
    });
    // Follow catalog updates (a card's set replaced, or arriving on first run).
    inject(CatalogSyncService)
      .changed$.pipe(debounceTime(300), takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => void this.loadCards());
  }

  /**
   * The row's owned line: "Own 2 of 3" when short, "Owned" when covered,
   * noting copies from other printings. Null until known.
   */
  ownedLine(row: DeckRow): { text: string; short: boolean } | null {
    const slot = this.owned()?.slots.get(row.key);
    if (!slot) {
      return null;
    }
    const base =
      slot.missing > 0 ? `Own ${String(slot.owned)} of ${String(row.slot.count)}` : 'Owned';
    const other = slot.fromOther > 0 ? ` · ${String(slot.fromOther)} from another printing` : '';
    return { text: base + other, short: slot.missing > 0 };
  }

  /** Turns missing-only on or off, listing what's still needed as it turns on. */
  showMissingOnly(on: boolean): void {
    const owned = this.owned();
    this.listed.set(
      new Set(
        on && owned
          ? this.sections().flatMap((section) =>
              section.rows
                .filter((row) => (owned.slots.get(row.key)?.missing ?? row.slot.count) > 0)
                .map((row) => row.key)
            )
          : []
      )
    );
    this.missingOnly.set(on);
  }

  /** The notes for a card's row: the rules it breaks. */
  notes(row: DeckRow): readonly string[] {
    return this.check()?.cardNotes.get(row.key) ?? [];
  }

  /**
   * Whether the deck holds as many copies of the card as it may: 4 with its
   * name (across printings), or 99 of a printing.
   */
  atLimit(row: DeckRow): boolean {
    const limit = this.check()?.limits.get(row.key);
    return row.slot.count >= MAX_DECK_CARD_COUNT || (!!limit && limit.total >= limit.limit);
  }

  /**
   * Adds or removes one copy of a card (none past its copy limit, saying
   * so). Steps run one at a time, each from the deck as the previous one
   * left it, so quick taps neither get lost nor pass the limit. Resolves
   * once saved (or the failure has been reported).
   */
  async step(row: DeckRow, delta: 1 | -1): Promise<void> {
    const applied = this.steps.then(() => this.applyStep(row, delta));
    this.steps = applied.then(
      () => undefined,
      () => undefined
    );
    try {
      await (
        await applied
      )?.saving;
    } catch (error: unknown) {
      await this.dialogs.showSaveError(error);
    }
  }

  async pickFormat(value: unknown): Promise<void> {
    // Against the stored format: an unknown one shows as Unlimited, and
    // picking Unlimited then makes it so.
    if (!isDeckFormat(value) || value === this.deck()?.format) {
      return;
    }
    try {
      await this.decks.update(this.id(), { format: value });
    } catch {
      await this.dialogs.showSaveError();
    }
  }

  async rename(): Promise<void> {
    const deck = this.deck();
    if (!deck) {
      return;
    }
    const name = await this.dialogs.askRename(deck);
    if (name === null) {
      return;
    }
    try {
      await this.decks.update(deck.id, { name });
    } catch {
      await this.dialogs.showSaveError();
    }
  }

  async delete(): Promise<void> {
    const deck = this.deck();
    if (!deck || !(await this.dialogs.confirmDelete(deck))) {
      return;
    }
    // Leave first: removing it while this page shows would flash "isn't on this device".
    this.deleting.set(true);
    await this.nav.navigateBack('/tabs/decks');
    try {
      await this.decks.remove(deck.id);
    } catch {
      await this.dialogs.showSaveError();
    }
  }

  /** Opens the Add cards modal: full screen on phones, a large dialog on desktop. */
  async addCards(): Promise<void> {
    const modal = await this.modals.create({
      component: AddCardsComponent,
      componentProps: { deckIdProp: this.id() },
      cssClass: 'add-cards-modal',
    });
    await modal.present();
  }

  /** Opens a card in the card modal, paging through the deck's cards in their listed order. */
  async openCard(row: DeckRow): Promise<void> {
    const cards = this.sections().flatMap((section) =>
      section.rows.flatMap((entry) => (entry.card ? [entry.card] : []))
    );
    const index = cards.findIndex((card) => catalogKey(card.region, card.id) === row.key);
    if (index < 0) {
      return;
    }
    // A sheet on phones, a centered dialog on desktop (docs/ui.md).
    const sheet = !this.layout.wide();
    const modal = await this.modals.create({
      component: CardDetailComponent,
      componentProps: { setsProp: this.catalog().sets, cardsProp: cards, startIndex: index },
      cssClass: 'card-detail-modal',
      ...(sheet ? { breakpoints: [0, 1], initialBreakpoint: 1, handle: true } : {}),
    });
    await modal.present();
  }

  /** Reads the deck's cards again (Try again, after a failed read). */
  retryCards(): void {
    void this.loadCards();
  }

  private async loadCards(): Promise<void> {
    const read = ++this.reads;
    const keys = this.cardKeys();
    try {
      const cards = await this.engine.getCatalogCardsByKey(keys);
      const setIds = new Map(
        cards.map((card) => [catalogKey(card.region, card.setId), card] as const)
      );
      const sets = await Promise.all(
        [...setIds.values()].map((card) => this.engine.getCatalogSet(card.region, card.setId))
      );
      if (read !== this.reads) {
        return;
      }
      this.readFailed.set(false);
      this.catalog.set({
        keys: new Set(keys),
        cards: new Map(cards.map((card) => [catalogKey(card.region, card.id), card])),
        sets: new Map(
          sets.flatMap((stored) =>
            stored ? [[catalogKey(stored.region, stored.set.id), stored.set] as const] : []
          )
        ),
      });
    } catch (error: unknown) {
      console.error('deck.cards_load_failed', error);
      if (read !== this.reads) {
        return;
      }
      // Keep what was read, and list the rest by ID so they can still be
      // seen and edited (with Try again), rather than hiding them.
      this.readFailed.set(true);
      this.catalog.update((catalog) => ({ ...catalog, keys: new Set(keys) }));
    }
  }

  /** The language a card not on this device is named in (its ID shows instead). */
  private fallbackLanguage(region: string): CatalogLanguage {
    return isCatalogRegion(region) ? this.catalogLanguage.forSet(region, []) : 'en';
  }
}

function sectionOf(card: CatalogCard | null): SectionId {
  if (!card) {
    return 'missing';
  }
  return card.category === 'Pokemon' || card.category === 'Trainer' || card.category === 'Energy'
    ? card.category
    : 'other';
}
