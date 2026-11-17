import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import type { ImageCacheUsage } from '../../core/data/storage-engine';
import { ImageCacheService } from '../../core/services/image-cache.service';
import { NavController } from '@ionic/angular';
import { ImageDownloadService } from '../../core/services/image-download.service';
import {
  ImagesSectionComponent,
  describeDownloads,
  describeLimit,
} from './images-section.component';

describe('describeLimit', () => {
  it.each([
    [250, '250 MB'],
    [500, '500 MB'],
    [1000, '1 GB'],
    [2000, '2 GB'],
  ])('describes %d', (limit, label) => {
    expect(describeLimit(limit)).toBe(label);
  });
});

describe('describeDownloads', () => {
  it.each([
    [{ sets: 0, bytes: 0 }, 'None'],
    [{ sets: 1, bytes: 14 * 1024 * 1024 }, '1 set · 14 MB'],
    [{ sets: 214, bytes: 3.1 * 1024 * 1024 * 1024 }, '214 sets · 3.1 GB'],
  ])('describes %o', (totals, label) => {
    expect(describeDownloads(totals)).toBe(label);
  });
});

describe('ImagesSectionComponent', () => {
  const usage = signal<ImageCacheUsage | null>(null);
  const totals = signal({ sets: 0, bytes: 0 });
  const imageCache = {
    usage: usage.asReadonly(),
    limitMb: signal(500).asReadonly(),
    setLimitMb: vi.fn(() => Promise.resolve()),
    clearRecentlyViewed: vi.fn(() => Promise.resolve()),
  };
  const downloads = { totals: totals.asReadonly(), refresh: vi.fn(() => Promise.resolve()) };
  const nav = { navigateForward: vi.fn(() => Promise.resolve(true)) };

  async function create(): Promise<ImagesSectionComponent> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: ImageCacheService, useValue: imageCache },
        { provide: ImageDownloadService, useValue: downloads },
        { provide: NavController, useValue: nav },
      ],
    });
    TestBed.overrideComponent(ImagesSectionComponent, { set: { template: '<div></div>' } });
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(ImagesSectionComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    usage.set(null);
    totals.set({ sets: 0, bytes: 0 });
  });

  it('loads downloads and usage on init', async () => {
    await create();

    expect(downloads.refresh).toHaveBeenCalled();
  });

  it('summarizes downloads and recently viewed images', async () => {
    const component = await create();
    expect(component.downloadsSummary()).toBe('None');
    expect(component.recentSize()).toBe('0 MB');
    expect(component.hasRecent()).toBe(false);

    totals.set({ sets: 2, bytes: 14 * 1024 * 1024 });
    usage.set({ pinnedBytes: 14 * 1024 * 1024, unpinnedBytes: 300 * 1024 });

    expect(component.downloadsSummary()).toBe('2 sets · 14 MB');
    expect(component.recentSize()).toBe('300 KB');
    expect(component.hasRecent()).toBe(true);
  });

  it('opens the downloaded sets page, changes the limit and clears recently viewed', async () => {
    const component = await create();

    component.openDownloads();
    await component.onLimitChange(1000);
    await component.clearRecent();

    expect(nav.navigateForward).toHaveBeenCalledWith('/tabs/settings/downloads');
    expect(imageCache.setLimitMb).toHaveBeenCalledWith(1000);
    expect(imageCache.clearRecentlyViewed).toHaveBeenCalled();
    expect(component.busy()).toBe(false);
  });
});
