import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DEFAULT_SETTINGS, type SyncEntityType } from '@pokepaper/shared';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { LocalUserDataRepository } from '../core/data/local-user-data-repository';
import { SyncService, type SyncStatus } from '../core/services/sync.service';
import { CARD_LANGUAGES, SettingsPage } from './settings.page';

describe('SettingsPage', () => {
  const status = signal<SyncStatus>('idle');
  const rejectedOperations = signal(0);
  let dataChanged: Subject<ReadonlySet<SyncEntityType>>;
  const repository = {
    getSettings: vi.fn(() => Promise.resolve({ ...DEFAULT_SETTINGS, cardLanguage: 'ja' })),
    updateSettings: vi.fn(() => Promise.resolve()),
  };

  async function createPage(): Promise<SettingsPage> {
    TestBed.configureTestingModule({
      providers: [
        { provide: LocalUserDataRepository, useValue: repository },
        {
          provide: SyncService,
          useValue: {
            status: status.asReadonly(),
            rejectedOperations: rejectedOperations.asReadonly(),
            dataChanged$: dataChanged.asObservable(),
          },
        },
      ],
    });
    TestBed.overrideComponent(SettingsPage, { set: { template: '<div></div>' } });
    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(SettingsPage);
    fixture.detectChanges();
    await fixture.componentInstance.loadSettings();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    status.set('idle');
    rejectedOperations.set(0);
    dataChanged = new Subject();
    vi.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it('loads stored settings on init', async () => {
    const page = await createPage();

    expect(repository.getSettings).toHaveBeenCalled();
    expect(page.settings().cardLanguage).toBe('ja');
  });

  it('persists a card language change through the repository', async () => {
    const page = await createPage();

    await page.onCardLanguageChange('fr');

    expect(page.settings().cardLanguage).toBe('fr');
    expect(repository.updateSettings).toHaveBeenCalledWith({ cardLanguage: 'fr' });
  });

  it('reloads when a pull changes settings, and ignores other entity types', async () => {
    const page = await createPage();
    repository.getSettings.mockResolvedValueOnce({ cardLanguage: 'ko' });

    dataChanged.next(new Set(['other' as SyncEntityType]));
    await Promise.resolve();
    expect(page.settings().cardLanguage).toBe('ja');

    dataChanged.next(new Set<SyncEntityType>(['settings']));
    await vi.waitFor(() => {
      expect(page.settings().cardLanguage).toBe('ko');
    });
  });

  it('reverts the selection and flags an error when saving fails', async () => {
    const page = await createPage();
    repository.updateSettings.mockRejectedValueOnce(new Error('quota exceeded'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await page.onCardLanguageChange('fr');

    expect(page.settings().cardLanguage).toBe('ja');
    expect(page.saveError()).toBe(true);
    consoleError.mockRestore();
  });

  it('exposes the count of server-rejected changes', async () => {
    const page = await createPage();

    rejectedOperations.set(2);

    expect(page.rejectedOperations()).toBe(2);
  });

  it('labels every sync status', async () => {
    const page = await createPage();

    for (const value of ['idle', 'syncing', 'offline', 'unauthorized', 'error'] as const) {
      status.set(value);
      expect(page.syncStatusLabel().length).toBeGreaterThan(0);
    }
    status.set('offline');
    expect(page.syncStatusLabel()).toContain('Offline');
  });

  it('offers unique language codes', () => {
    const codes = CARD_LANGUAGES.map((language) => language.code);

    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain(DEFAULT_SETTINGS.cardLanguage);
  });
});
