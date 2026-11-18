import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { makeContractPack } from '../../core/data/storage-engine.contract';
import { CatalogBrowseService } from '../../core/services/catalog-browse.service';
import { CatalogSyncService } from '../../core/services/catalog-sync.service';
import { ImageDownloadService } from '../../core/services/image-download.service';
import { CatalogSegmentComponent } from './catalog-segment.component';
import { SetsListComponent } from './sets-list.component';

describe('sets list and catalog segment', () => {
  const setRegion = vi.fn(() => Promise.resolve());
  const browse = {
    region: signal('intl'),
    language: signal('de'),
    groups: signal([]),
    loaded: signal(true),
    setRegion,
  };
  const downloads = {
    offlineSets: signal([{ setKey: 'intl:sv01' }]),
    refresh: vi.fn(() => Promise.resolve()),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: CatalogBrowseService, useValue: browse },
        { provide: ImageDownloadService, useValue: downloads },
        {
          provide: CatalogSyncService,
          useValue: { progress: signal(null), status: signal('idle') },
        },
      ],
    });
    for (const component of [SetsListComponent, CatalogSegmentComponent]) {
      TestBed.overrideComponent(component, { set: { template: '', imports: [] } });
    }
    await TestBed.compileComponents();
  });

  it('names sets in the catalog language and marks downloaded ones', () => {
    const list = TestBed.createComponent(SetsListComponent).componentInstance;
    const set = {
      ...makeContractPack('intl', 'sv01', []).set,
      names: { en: 'Scarlet', de: 'Karmesin' },
    };

    list.ngOnInit();

    expect(downloads.refresh).toHaveBeenCalled();
    expect(list.name(set)).toBe('Karmesin');
    expect(list.key(set)).toBe('intl:sv01');
    expect(computed(() => list.downloaded().has('intl:sv01'))()).toBe(true);
  });

  it('switches catalogs from the segment, ignoring unknown values', () => {
    const segment = TestBed.createComponent(CatalogSegmentComponent).componentInstance;

    segment.select('asia');
    segment.select('elsewhere');

    expect(setRegion).toHaveBeenCalledTimes(1);
    expect(setRegion).toHaveBeenCalledWith('asia');
  });
});
