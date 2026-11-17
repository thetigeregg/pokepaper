import { TestBed } from '@angular/core/testing';
import { DEFAULT_SETTINGS, type SyncEntityType, type UserSettings } from '@pokepaper/shared';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { LocalUserDataRepository } from '../data/local-user-data-repository';
import { CatalogLanguageService } from './catalog-language.service';
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
    await service.pick('intl', 'de');
    expect(repository.updateSettings).toHaveBeenCalledTimes(1);
  });

  it('opens a set in the remembered language if it has it, else its first', async () => {
    stored = { cardLanguage: 'en', catalogLanguages: { intl: 'de' } };
    const service = await create();
    await vi.waitFor(() => {
      expect(service.languages().intl).toBe('de');
    });

    expect(service.forSet('intl', ['en', 'fr', 'de'])).toBe('de');
    expect(service.forSet('intl', ['fr'])).toBe('fr');
  });

  it('reloads when a sync changes settings', async () => {
    const service = await create();
    stored = { cardLanguage: 'en', catalogLanguages: { asia: 'zh-tw' } };

    dataChanged.next(new Set(['settings']));

    await vi.waitFor(() => {
      expect(service.languages().asia).toBe('zh-tw');
    });
  });
});
