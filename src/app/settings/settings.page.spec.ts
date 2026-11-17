import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SyncService, type SyncStatus } from '../core/services/sync.service';
import { SettingsPage } from './settings.page';

describe('SettingsPage', () => {
  const status = signal<SyncStatus>('idle');
  const rejectedOperations = signal(0);

  async function createPage(): Promise<SettingsPage> {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SyncService,
          useValue: {
            status: status.asReadonly(),
            rejectedOperations: rejectedOperations.asReadonly(),
          },
        },
      ],
    });
    TestBed.overrideComponent(SettingsPage, { set: { template: '<div></div>', imports: [] } });
    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(SettingsPage);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    status.set('idle');
    rejectedOperations.set(0);
    TestBed.resetTestingModule();
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
});
