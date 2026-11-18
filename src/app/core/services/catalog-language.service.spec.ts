import { TestBed } from '@angular/core/testing';
import { DEFAULT_SETTINGS, type SyncEntityType, type UserSettings } from '@pokepaper/shared';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { LocalUserDataRepository } from '../data/local-user-data-repository';
import { CatalogLanguageService, inDisplayOrder } from './catalog-language.service';
import { SyncService } from './sync.service';

describe('CatalogLanguageService', () => {
  let stored: UserSettings;
  const dataChanged = new Subject<ReadonlySet<SyncEntityType>>();
  const repository = {
    getSettings: vi.fn(() => Promise.resolve(stored)),
    updateSettings: vi.fn((settings: UserSettings) => {
      stored = settings;
      return Promise.resolve();
    }),
  };

  async function create(): Promise<CatalogLanguageService> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: LocalUserDataRepository, useValue: repository },
        { provide: SyncService, useValue: { dataChanged$: dataChanged.asObservable() } },
      ],
    });
    const service = TestBed.inject(CatalogLanguageService);
    await vi.waitFor(() => {
      expect(repository.getSettings).toHaveBeenCalled();
    });
    await Promise.resolve();
    return service;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    stored = { ...DEFAULT_SETTINGS };
  });

  it('defaults to English and Japanese', async () => {
    const service = await create();

    expect(service.languages()).toEqual({ intl: 'en', asia: 'ja' });
  });

  it('remembers a pick per catalog and saves it', async () => {
    const service = await create();

    await service.pick('intl', 'de');

    expect(service.languages()).toEqual({ intl: 'de', asia: 'ja' });
    expect(repository.updateSettings).toHaveBeenCalledWith({
      cardLanguage: 'en',
      catalogLanguages: { intl: 'de' },
    });
    await service.pick('intl', 'de'); // Already remembered: not saved again.
    expect(repository.updateSettings).toHaveBeenCalledTimes(1);
  });

  it('opens a set in the remembered language if it has it, else its first in display order', async () => {
    stored = { cardLanguage: 'en', catalogLanguages: { intl: 'de' } };
    const service = await create();
    await vi.waitFor(() => {
      expect(service.languages().intl).toBe('de');
    });

    expect(service.forSet('intl', ['en', 'fr', 'de'])).toBe('de');
    expect(service.forSet('intl', ['fr'])).toBe('fr');
    expect(service.forSet('intl', ['it', 'fr'])).toBe('fr'); // Display order, not catalog order.
    expect(service.forSet('asia', ['zh-cn', 'zh-tw'])).toBe('zh-tw');
  });

  it('reloads when a sync changes settings', async () => {
    const service = await create();
    stored = { cardLanguage: 'en', catalogLanguages: { asia: 'zh-tw' } };

    dataChanged.next(new Set(['settings']));

    await vi.waitFor(() => {
      expect(service.languages().asia).toBe('zh-tw');
    });
  });

  it('keeps the other catalog’s stored language when picking before settings load', async () => {
    stored = { cardLanguage: 'en', catalogLanguages: { asia: 'zh-tw' } };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: LocalUserDataRepository, useValue: repository },
        { provide: SyncService, useValue: { dataChanged$: dataChanged.asObservable() } },
      ],
    });
    const service = TestBed.inject(CatalogLanguageService); // Initial load still pending.

    await service.pick('intl', 'de');

    expect(stored.catalogLanguages).toEqual({ asia: 'zh-tw', intl: 'de' });
    expect(service.languages()).toEqual({ intl: 'de', asia: 'zh-tw' });
  });

  it('ignores a settings load that started before a pick', async () => {
    const service = await create();
    let release: (settings: UserSettings) => void = () => undefined;
    repository.getSettings.mockImplementationOnce(
      () => new Promise<UserSettings>((resolve) => (release = resolve))
    );
    dataChanged.next(new Set(['settings'])); // Load in flight with old settings.

    await service.pick('intl', 'fr');
    release({ cardLanguage: 'en' });
    await Promise.resolve();

    expect(service.languages().intl).toBe('fr');
  });

  it('saves quick picks in order, in either catalog', async () => {
    const service = await create();

    await Promise.all([
      service.pick('intl', 'fr'),
      service.pick('asia', 'zh-tw'),
      service.pick('intl', 'it'),
    ]);

    expect(service.languages()).toEqual({ intl: 'it', asia: 'zh-tw' });
    expect(stored.catalogLanguages).toEqual({ intl: 'it', asia: 'zh-tw' });
  });

  it('ignores a settings load while a pick is still saving', async () => {
    const service = await create();
    let commit: () => void = () => undefined;
    repository.updateSettings.mockImplementationOnce((settings: UserSettings) => {
      return new Promise<void>((resolve) => {
        commit = () => {
          stored = settings;
          resolve();
        };
      });
    });
    const picking = service.pick('intl', 'fr');
    await vi.waitFor(() => {
      expect(repository.updateSettings).toHaveBeenCalled();
    });

    dataChanged.next(new Set(['settings'])); // Reads the old, uncommitted settings.
    await Promise.resolve();
    expect(service.languages().intl).toBe('fr');

    commit();
    await picking;
    expect(service.languages().intl).toBe('fr');
  });

  it('shows the saved language again when saving a pick fails', async () => {
    const service = await create();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    repository.updateSettings.mockRejectedValueOnce(new Error('quota'));

    await service.pick('intl', 'fr');

    expect(service.languages().intl).toBe('en');
    expect(error).toHaveBeenCalledWith('catalog.language_save_failed', expect.any(Error));
    error.mockRestore();
  });

  it('keeps catalog languages from newer clients when saving', async () => {
    stored = { cardLanguage: 'en', catalogLanguages: { kr: 'ko' } };
    const service = await create();

    await service.pick('asia', 'zh-cn');

    expect(stored.catalogLanguages).toEqual({ kr: 'ko', asia: 'zh-cn' });
    expect(service.languages()).toEqual({ intl: 'en', asia: 'zh-cn' });
  });
});

describe('inDisplayOrder', () => {
  it('lists English, then German, French and Italian, then Asian languages', () => {
    expect(inDisplayOrder(['en', 'fr', 'it', 'de'])).toEqual(['en', 'de', 'fr', 'it']);
    expect(inDisplayOrder(['zh-cn', 'ja', 'zh-tw'])).toEqual(['ja', 'zh-tw', 'zh-cn']);
  });

  it('leaves the given array untouched', () => {
    const languages = ['fr', 'de'] as const;

    inDisplayOrder(languages);

    expect(languages).toEqual(['fr', 'de']);
  });
});
