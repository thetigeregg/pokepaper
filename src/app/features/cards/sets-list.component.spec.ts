import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { makeContractPack } from '../../core/data/storage-engine.contract';
import { CatalogBrowseService } from '../../core/services/catalog-browse.service';
import { CatalogLanguageService } from '../../core/services/catalog-language.service';
import { CatalogSyncService } from '../../core/services/catalog-sync.service';
import { CollectionService } from '../../core/services/collection.service';
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
  const ownedInSet = vi.fn((_region: string, setId: string, language: string) =>
    setId === 'sv01' && language === 'de' ? 87 : 0
  );
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
        { provide: CollectionService, useValue: { ownedInSet } },
        {
          provide: CatalogLanguageService,
          // The remembered language if the set has it, else its first.
          useValue: {
            forSet: (_region: string, languages: string[]) =>
              languages.includes('de') ? 'de' : languages[0],
          },
        },
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

  it('counts owned cards in the language each set opens in', () => {
    const list = TestBed.createComponent(SetsListComponent).componentInstance;
    const set = makeContractPack('intl', 'sv01', []).set;

    expect(list.owned({ ...set, languages: ['en', 'de'] })).toBe(87);
    expect(ownedInSet).toHaveBeenLastCalledWith('intl', 'sv01', 'de');
    expect(list.owned({ ...set, languages: ['en'] })).toBe(0);
    expect(ownedInSet).toHaveBeenLastCalledWith('intl', 'sv01', 'en');
  });

  it('switches catalogs from the segment, ignoring unknown values', () => {
    const segment = TestBed.createComponent(CatalogSegmentComponent).componentInstance;

    segment.select('asia');
    segment.select('elsewhere');

    expect(setRegion).toHaveBeenCalledTimes(1);
    expect(setRegion).toHaveBeenCalledWith('asia');
  });
});
