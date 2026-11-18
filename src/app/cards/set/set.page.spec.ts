import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ActionSheetController, AlertController, ModalController } from '@ionic/angular';
import type { CatalogLanguage, CatalogRegion, CatalogSet } from '@pokepaper/shared';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { makeContractPack } from '../../core/data/storage-engine.contract';
import { StorageEngineFactory } from '../../core/data/storage-engine.factory';
import { CatalogLanguageService } from '../../core/services/catalog-language.service';
import { CatalogSyncService } from '../../core/services/catalog-sync.service';
import { CollectionService } from '../../core/services/collection.service';
import { ImageCacheService } from '../../core/services/image-cache.service';
import {
  ImageDownloadService,
  type SetDownloadProgress,
} from '../../core/services/image-download.service';
import { LayoutService } from '../../core/services/layout.service';
import { VisibilityService } from '../../core/services/visibility.service';
import { CardDetailComponent } from '../../features/cards/card-detail.component';
import { PreferenceStorageService } from '../../core/storage/preference-storage.service';
import { SET_VIEW_KEY, SetPage } from './set.page';

/** An empty collection, for specs that don't test collection tracking. */
const EMPTY_COLLECTION: Partial<CollectionService> = {
  loaded: signal(true),
  quantity: () => 0,
  cardTotal: () => 0,
  otherLanguages: () => [],
  ownedInSet: () => 0,
};

interface SheetButton {
  text: string;
  role?: string;
  handler?: () => void;
}

describe('SetPage', () => {
  const pack = makeContractPack('intl', 'sv01', ['sv01-001', 'sv01-002']);
  const set: CatalogSet = {
    ...pack.set,
    abbreviation: 'SVI',
    names: { en: 'Scarlet & Violet', de: 'Karmesin & Purpur' },
    languages: ['en', 'de'],
  };
  const cards = [...pack.cards].sort((a, b) => a.sortIndex - b.sortIndex);

  const engine = {
    getCatalogSet: vi.fn((_region: CatalogRegion, _id: string) =>
      Promise.resolve<{ set: CatalogSet } | null>({ set })
    ),
    listCatalogCards: vi.fn((_region: CatalogRegion, _id: string) => Promise.resolve(cards)),
  };
  const changed$ = new Subject<void>();
  const pick = vi.fn(() => Promise.resolve());
  const language = signal<CatalogLanguage>('de');
  const wide = signal(false);
  const downloads = {
    progress: signal<ReadonlyMap<string, SetDownloadProgress>>(new Map()),
    offlineSets: signal<{ setKey: string }[]>([]),
    refresh: vi.fn(() => Promise.resolve()),
    downloadSet: vi.fn(() => Promise.resolve()),
    removeSet: vi.fn(() => Promise.resolve()),
  };
  const present = vi.fn(() => Promise.resolve());
  const createSheet = vi.fn((_options: { header: string; buttons: SheetButton[] }) =>
    Promise.resolve({ present })
  );
  const createModal = vi.fn((_options: Record<string, unknown>) => Promise.resolve({ present }));
  const preferences = new Map<string, string>();
  const preferenceStorage = {
    getItem: vi.fn((key: string) => Promise.resolve(preferences.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      preferences.set(key, value);
      return Promise.resolve();
    }),
  };

  let fixture: ComponentFixture<SetPage>;

  async function create(): Promise<SetPage> {
    fixture = TestBed.createComponent(SetPage);
    fixture.componentRef.setInput('region', 'intl');
    fixture.componentRef.setInput('setId', 'sv01');
    fixture.detectChanges();
    await settle();
    return fixture.componentInstance;
  }

  /** Lets loads (native async/await, which Zone.js can't track) finish, then renders. */
  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }

  const root = () => fixture.nativeElement as HTMLElement;
  const query = (selector: string) => root().querySelector(selector);
  const sheetButtons = () => createSheet.mock.lastCall?.[0].buttons ?? [];

  beforeEach(() => {
    vi.clearAllMocks();
    preferences.clear();
    language.set('de');
    wide.set(false);
    downloads.progress.set(new Map());
    downloads.offlineSets.set([]);
    engine.getCatalogSet.mockResolvedValue({ set });
    engine.listCatalogCards.mockResolvedValue(cards);
    TestBed.configureTestingModule({
      providers: [
        { provide: CollectionService, useValue: EMPTY_COLLECTION },
        provideRouter([]),
        { provide: StorageEngineFactory, useValue: { getEngine: () => engine } },
        {
          provide: CatalogLanguageService,
          useValue: { forSet: () => language(), pick },
        },
        { provide: CatalogSyncService, useValue: { changed$ } },
        { provide: ImageDownloadService, useValue: downloads },
        { provide: LayoutService, useValue: { wide } },
        { provide: ActionSheetController, useValue: { create: createSheet } },
        { provide: ModalController, useValue: { create: createModal } },
        {
          provide: ImageCacheService,
          useValue: { resolve: vi.fn(() => Promise.resolve(null)), release: vi.fn() },
        },
        { provide: VisibilityService, useValue: { whenVisible: () => () => undefined } },
        { provide: PreferenceStorageService, useValue: preferenceStorage },
        { provide: AlertController, useValue: { create: vi.fn() } },
      ],
    });
  });

  describe('checklist view', () => {
    const viewButton = () => query('[data-testid="view-button"]') as HTMLElement | null;

    it('switches between the grid and the checklist, remembering the choice', async () => {
      const page = await create();
      expect(page.view()).toBe('grid');
      expect(query('app-set-checklist')).toBeNull();

      viewButton()?.click();
      await settle();

      expect(page.view()).toBe('checklist');
      expect(preferences.get(SET_VIEW_KEY)).toBe('checklist');
      expect(query('.page-column app-set-checklist')).not.toBeNull();
      expect(root().querySelectorAll('[data-testid^="checklist-sv01-"]')).toHaveLength(2);
      expect(query('app-card-tile')).toBeNull();

      viewButton()?.click();
      await settle();
      expect(preferences.get(SET_VIEW_KEY)).toBe('grid');
      expect(query('app-card-tile')).not.toBeNull();
    });

    it('opens in the remembered view, ignoring unknown values', async () => {
      preferences.set(SET_VIEW_KEY, 'checklist');
      expect((await create()).view()).toBe('checklist');

      preferences.set(SET_VIEW_KEY, 'carousel');
      expect((await create()).view()).toBe('grid');
    });

    it('opens a checklist card in the card modal', async () => {
      preferences.set(SET_VIEW_KEY, 'checklist');
      await create();

      (
        query('[data-testid="checklist-sv01-002"] [data-testid="open-card"]') as HTMLElement | null
      )?.click();
      await settle();

      expect(createModal).toHaveBeenCalledWith(
        expect.objectContaining({
          component: CardDetailComponent,
          componentProps: expect.objectContaining({ startIndex: 1 }) as unknown,
        })
      );
    });

    it('keeps working when the view preference can’t be read or saved', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      preferenceStorage.getItem.mockRejectedValueOnce(new Error('locked'));
      preferenceStorage.setItem.mockRejectedValueOnce(new Error('locked'));
      const page = await create();
      expect(page.view()).toBe('grid');

      await page.toggleView();

      expect(page.view()).toBe('checklist');
      expect(error).toHaveBeenCalledWith('catalog.set_view_load_failed', expect.any(Error));
      expect(error).toHaveBeenCalledWith('catalog.set_view_save_failed', expect.any(Error));
      error.mockRestore();
    });
  });

  it("lists the set's cards in the catalog language", async () => {
    const page = await create();

    expect(engine.getCatalogSet).toHaveBeenCalledWith('intl', 'sv01');
    expect(downloads.refresh).toHaveBeenCalled();
    expect(page.title()).toBe('Karmesin & Purpur');
    expect(page.key()).toBe('intl:sv01');
    expect(query('app-set-logo')?.textContent.trim()).toBe('Karmesin & Purpur');
    expect([...root().querySelectorAll('.caption')].map((c) => c.textContent)).toEqual([
      '001 · sv01-001',
      '002 · sv01-002',
    ]);
    expect(page.line(cards[0])).toBe('SVI · 001/2');
    expect(query('ion-back-button')).not.toBeNull();
    expect(page.downloaded()).toBe(false);
    expect(query('[data-testid="download-button"]')).not.toBeNull();
    expect(query('ion-progress-bar')).toBeNull();
  });

  it('hides the back button beside the split view on desktop', async () => {
    wide.set(true);
    await create();

    expect(query('ion-back-button')).toBeNull();
  });

  it("says when the set isn't on this device", async () => {
    engine.getCatalogSet.mockResolvedValue(null);
    engine.listCatalogCards.mockResolvedValue([]);
    const page = await create();

    expect(root().textContent).toContain("This set isn't on this device.");
    expect(query('[data-testid="download-button"]')).toBeNull();
    expect(page.line(cards[0])).toBe('001');

    await page.openDownloadActions();
    await page.openCard(0);
    expect(createSheet).not.toHaveBeenCalled();
    expect(createModal).not.toHaveBeenCalled();
  });

  it('logs a failed load and stops loading', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    engine.getCatalogSet.mockRejectedValue(new Error('disk'));
    const page = await create();

    expect(page.loaded()).toBe(true);
    expect(error).toHaveBeenCalledWith('catalog.set_load_failed', expect.any(Error));
    error.mockRestore();
  });

  it('reloads when the catalog changes', async () => {
    await create();
    engine.getCatalogSet.mockClear();

    vi.useFakeTimers();
    try {
      changed$.next();
      await vi.advanceTimersByTimeAsync(299);
      expect(engine.getCatalogSet).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1); // The 300ms debounce.
    } finally {
      vi.useRealTimers();
    }

    expect(engine.getCatalogSet).toHaveBeenCalledTimes(1);
  });

  it('switches language', async () => {
    const page = await create();

    page.pickLanguage('en');

    expect(pick).toHaveBeenCalledWith('intl', 'en');
  });

  it('offers downloads in the language or all languages', async () => {
    const page = await create();

    await page.openDownloadActions();

    expect(createSheet.mock.lastCall?.[0].header).toBe('Download images for offline use');
    expect(sheetButtons().map((b) => b.text)).toEqual([
      'Download in German',
      'Download in all languages',
      'Cancel',
    ]);
    sheetButtons()[0]?.handler?.();
    sheetButtons()[1]?.handler?.();
    expect(downloads.downloadSet).toHaveBeenNthCalledWith(1, 'intl', 'sv01', ['de']);
    expect(downloads.downloadSet).toHaveBeenNthCalledWith(2, 'intl', 'sv01', ['en', 'de']);
    expect(present).toHaveBeenCalled();
  });

  it('marks a downloaded set and offers to remove it', async () => {
    downloads.offlineSets.set([{ setKey: 'intl:sv01' }]);
    const page = await create();

    expect(page.downloaded()).toBe(true);
    await page.openDownloadActions();

    expect(createSheet.mock.lastCall?.[0].header).toBe('Downloaded for offline use');
    const remove = sheetButtons().find((b) => b.role === 'destructive');
    remove?.handler?.();
    expect(downloads.removeSet).toHaveBeenCalledWith('intl:sv01');
  });

  it('offers only the one language when the set has one', async () => {
    engine.getCatalogSet.mockResolvedValue({ set: { ...set, languages: ['de'] } });
    const page = await create();

    await page.openDownloadActions();

    expect(sheetButtons().map((b) => b.text)).toEqual(['Download in German', 'Cancel']);
  });

  it('shows progress and disables the download button while downloading', async () => {
    downloads.progress.set(new Map([['intl:sv01', { running: true, done: 1, total: 4 }]]));
    const page = await create();

    expect(page.downloading()).toBe(true);
    expect(query('ion-progress-bar')).not.toBeNull();
    expect(query('[data-testid="download-button"]')?.hasAttribute('disabled')).toBe(true);
  });

  it('opens a tapped card in a sheet on phones', async () => {
    const page = await create();

    (root().querySelectorAll('.card-button')[1] as HTMLButtonElement).click();
    await settle();

    expect(createModal).toHaveBeenCalledWith(
      expect.objectContaining({
        component: CardDetailComponent,
        componentProps: { setProp: set, cardsProp: cards, startIndex: 1 },
        breakpoints: [0, 1],
        initialBreakpoint: 1,
      })
    );
    expect(page.cards()).toHaveLength(2);
    expect(present).toHaveBeenCalled();
  });

  it('opens a card in a centered dialog on desktop', async () => {
    wide.set(true);
    const page = await create();

    await page.openCard(0);

    expect(createModal.mock.lastCall?.[0]).not.toHaveProperty('breakpoints');
  });
});
