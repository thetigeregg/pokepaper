import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AlertController } from '@ionic/angular';
import { vi } from 'vitest';
import { ImageDownloadService, type OfflineSet } from '../../core/services/image-download.service';
import { DownloadsPage, describeLanguages, groupBySeries } from './downloads.page';

const MB = 1024 * 1024;
const set = (
  setId: string,
  serie: string,
  name: string,
  languages: OfflineSet['languages'],
  bytes: number
): OfflineSet => ({
  setKey: `intl:${setId}`,
  region: 'intl',
  setId,
  name,
  serieKey: `intl:${serie}`,
  serieName: serie === 'sv' ? 'Scarlet & Violet' : 'Sword & Shield',
  releaseDate: null,
  languages,
  images: 100,
  bytes,
});

const SETS = [
  set('sv02', 'sv', 'Paldea Evolved', ['en', 'de'], 15 * MB),
  set('sv01', 'sv', 'Scarlet & Violet', ['de'], 14 * MB),
  set('swsh1', 'swsh', 'Sword & Shield', ['en'], 10 * MB),
];

describe('describeLanguages / groupBySeries', () => {
  it('formats language codes', () => {
    expect(describeLanguages(['en', 'zh-tw'])).toBe('EN ZH-TW');
  });

  it('groups sets by series in order, combining languages and sizes', () => {
    expect(
      groupBySeries(SETS).map((group) => ({
        key: group.key,
        languages: group.languages,
        sets: group.sets.map((entry) => entry.setId),
        bytes: group.bytes,
      }))
    ).toEqual([
      { key: 'intl:sv', languages: ['en', 'de'], sets: ['sv02', 'sv01'], bytes: 29 * MB },
      { key: 'intl:swsh', languages: ['en'], sets: ['swsh1'], bytes: 10 * MB },
    ]);
  });
});

describe('DownloadsPage', () => {
  const offlineSets = signal<OfflineSet[]>([]);
  const downloads = {
    offlineSets: offlineSets.asReadonly(),
    totals: computed(() => ({
      sets: offlineSets().length,
      bytes: offlineSets().reduce((total, entry) => total + entry.bytes, 0),
    })),
    refresh: vi.fn(() => Promise.resolve()),
    removeSet: vi.fn(() => Promise.resolve()),
    removeSets: vi.fn(() => Promise.resolve()),
  };
  let dismissRole = 'confirm';
  const alerts = {
    create: vi.fn(() =>
      Promise.resolve({
        present: () => Promise.resolve(),
        onDidDismiss: () => Promise.resolve({ role: dismissRole }),
      })
    ),
  };

  async function create(): Promise<DownloadsPage> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: ImageDownloadService, useValue: downloads },
        { provide: AlertController, useValue: alerts },
      ],
    });
    TestBed.overrideComponent(DownloadsPage, { set: { template: '<div></div>', imports: [] } });
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(DownloadsPage);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    offlineSets.set(SETS);
    dismissRole = 'confirm';
  });

  it('loads downloads and summarizes them', async () => {
    const page = await create();

    expect(downloads.refresh).toHaveBeenCalled();
    expect(page.totals()).toBe('3 sets · 39 MB');
    expect(page.groups().map((group) => group.name)).toEqual([
      'Scarlet & Violet',
      'Sword & Shield',
    ]);
  });

  it('filters by set or series name, ignoring case and accents, and opens matching series', async () => {
    const page = await create();

    page.onSearch('PALDEA');
    expect(page.groups().map((group) => group.sets.map((entry) => entry.setId))).toEqual([
      ['sv02'],
    ]);
    expect(page.openSeries()).toEqual(['intl:sv']);

    page.onSearch('sword');
    expect(page.groups().map((group) => group.key)).toEqual(['intl:swsh']);

    page.onSearch('pokémon');
    expect(page.groups()).toEqual([]);
  });

  it('remembers which series the user opened when not searching', async () => {
    const page = await create();

    page.onToggle(['intl:swsh']);
    expect(page.openSeries()).toEqual(['intl:swsh']);

    page.onSearch('paldea');
    page.onToggle([]); // Ignored while searching.
    page.onSearch('');
    expect(page.openSeries()).toEqual(['intl:swsh']);
  });

  it('removes a set without asking', async () => {
    const page = await create();

    await page.removeSet(SETS[0]);

    expect(alerts.create).not.toHaveBeenCalled();
    expect(downloads.removeSet).toHaveBeenCalledWith('intl:sv02');
  });

  it('asks before removing a series, without toggling it', async () => {
    const page = await create();
    const event = new Event('click');
    const stop = vi.spyOn(event, 'stopPropagation');
    const series = page.groups()[0];

    await page.removeSeries(series, event);
    expect(stop).toHaveBeenCalled();
    expect(downloads.removeSets).toHaveBeenCalledWith(['intl:sv02', 'intl:sv01']);

    dismissRole = 'cancel';
    downloads.removeSets.mockClear();
    await page.removeSeries(series);
    expect(downloads.removeSets).not.toHaveBeenCalled();
  });

  it('asks before removing everything', async () => {
    const page = await create();

    await page.removeAll();

    expect(downloads.removeSets).toHaveBeenCalledWith(['intl:sv02', 'intl:sv01', 'intl:swsh1']);
    expect(page.busy()).toBe(false);
  });
});
