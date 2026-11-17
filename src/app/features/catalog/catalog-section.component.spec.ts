import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import type { CatalogStats } from '../../core/data/storage-engine';
import {
  CatalogSyncService,
  type CatalogSyncStatus,
} from '../../core/services/catalog-sync.service';
import { CatalogSectionComponent, describeAge, describeBytes } from './catalog-section.component';

describe('describeAge', () => {
  const now = new Date('2026-01-10T12:00:00Z');

  it.each([
    [new Date('2026-01-10T11:59:30Z'), 'just now'],
    [new Date('2026-01-10T11:55:00Z'), '5 minutes ago'],
    [new Date('2026-01-10T09:00:00Z'), '3 hours ago'],
    [new Date('2026-01-09T12:00:00Z'), 'yesterday'],
    [new Date('2026-01-06T12:00:00Z'), '4 days ago'],
  ])('describes %s', (then, expected) => {
    expect(describeAge(then, now)).toBe(expected);
  });
});

describe('describeBytes', () => {
  it.each([
    [512, '1 KB'],
    [300 * 1024, '300 KB'],
    [118 * 1024 * 1024, '118 MB'],
    [2.5 * 1024 * 1024 * 1024, '2.5 GB'],
  ])('describes %d bytes', (bytes, expected) => {
    expect(describeBytes(bytes)).toBe(expected);
  });
});

describe('CatalogSectionComponent', () => {
  const status = signal<CatalogSyncStatus>('idle');
  const progress = signal<{ done: number; total: number } | null>(null);
  const stats = signal<CatalogStats | null>(null);
  const lastChecked = signal<Date | null>(null);
  const syncNow = vi.fn(() => Promise.resolve());

  async function create(): Promise<CatalogSectionComponent> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CatalogSyncService,
          useValue: {
            status: status.asReadonly(),
            progress: progress.asReadonly(),
            stats: stats.asReadonly(),
            lastChecked: lastChecked.asReadonly(),
            syncNow,
          },
        },
      ],
    });
    TestBed.overrideComponent(CatalogSectionComponent, { set: { template: '<div></div>' } });
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(CatalogSectionComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    status.set('idle');
    progress.set(null);
    stats.set(null);
    lastChecked.set(null);
    syncNow.mockClear();
  });

  it('describes a catalog that was never checked', async () => {
    const component = await create();

    expect(component.statusLabel()).toBe('Up to date');
    expect(component.lastChecked()).toBe('Never');
    expect(component.busy()).toBe(false);
  });

  it('shows download progress', async () => {
    const component = await create();

    status.set('downloading');
    progress.set({ done: 120, total: 386 });

    expect(component.statusLabel()).toBe('Downloading 120 of 386 sets');
    expect(component.busy()).toBe(true);
  });

  it('describes when it was last checked', async () => {
    lastChecked.set(new Date(Date.now() - 5 * 60 * 1000));

    expect((await create()).lastChecked()).toBe('5 minutes ago');
  });

  it.each<[CatalogSyncStatus, string]>([
    ['offline', 'Offline: using the copy on this device'],
    ['unauthorized', 'Sign in to update'],
    ['error', 'Update failed: will retry'],
    ['checking', 'Checking for updates…'],
  ])('labels the %s status', async (value, label) => {
    status.set(value);

    expect((await create()).statusLabel()).toBe(label);
  });

  it('checks for updates on request', async () => {
    const component = await create();

    component.checkForUpdates();

    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it('reports storage used in the browser', async () => {
    const estimate = vi.fn(() => Promise.resolve({ usage: 118 * 1024 * 1024, quota: 0 }));
    Object.defineProperty(navigator, 'storage', { value: { estimate }, configurable: true });
    stats.set({ sets: 1, cards: 1 });

    const component = await create();

    await vi.waitFor(() => {
      expect(component.storageUsed()).toBe('118 MB');
    });
    Reflect.deleteProperty(navigator, 'storage');
  });
});
