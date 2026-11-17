import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DEFAULT_SETTINGS } from '@pokepaper/shared';
import { vi } from 'vitest';
import { LocalUserDataRepository } from '../core/data/local-user-data-repository';
import { SyncService, type SyncStatus } from '../core/services/sync.service';
import { CARD_LANGUAGES, SettingsPage } from './settings.page';

describe('SettingsPage', () => {
  const status = signal<SyncStatus>('idle');
  const repository = {
    getSettings: vi.fn(() => Promise.resolve({ ...DEFAULT_SETTINGS, cardLanguage: 'ja' })),
    updateSettings: vi.fn(() => Promise.resolve()),
  };

  async function createPage(): Promise<SettingsPage> {
    TestBed.configureTestingModule({
      providers: [
        { provide: LocalUserDataRepository, useValue: repository },
        { provide: SyncService, useValue: { status: status.asReadonly() } },
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
    vi.clearAllMocks();
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
