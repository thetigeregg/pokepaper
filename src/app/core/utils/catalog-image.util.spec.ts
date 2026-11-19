import type { CatalogCard } from '@pokepaper/shared';
import { displayImage, regionLanguages } from './catalog-image.util';

const card = (images: Partial<Record<string, string | null>>, region: 'intl' | 'asia' = 'intl') =>
  ({
    region,
    id: 'sv01-001',
    text: Object.fromEntries(
      Object.entries(images).map(([language, image]) => [language, { name: 'x', image }])
    ),
  }) as unknown as CatalogCard;

describe('regionLanguages', () => {
  it('lists each region’s languages in display order', () => {
    expect(regionLanguages('intl')).toEqual(['en', 'fr', 'it', 'de']);
    expect(regionLanguages('asia')).toEqual(['ja', 'zh-tw', 'zh-cn']);
  });
});

describe('displayImage', () => {
  it('uses the requested language’s scan', () => {
    expect(displayImage(card({ en: 'a', de: 'b' }), 'de', 'low')).toEqual({
      language: 'de',
      url: '/images/catalog/cards/intl/sv01-001/de/low.webp',
      borrowed: false,
    });
  });

  it('marks another printing’s scan, its URL naming the source', () => {
    const energy = card({ en: 'en/sv/sve/2' });
    (energy.text.en as { imageFrom?: string }).imageFrom = 'sve-2';

    expect(displayImage(energy, 'en', 'low')).toEqual({
      language: 'en',
      url: '/images/catalog/cards/intl/sv01-001/en/low.webp?from=sve-2',
      borrowed: true,
    });
  });

  it('falls back to the first other language in the region with a scan', () => {
    expect(displayImage(card({ en: null, fr: 'a', de: null }), 'de', 'high')?.language).toBe('fr');
    expect(displayImage(card({ ja: null, 'zh-tw': 'a' }, 'asia'), 'ja', 'low')?.url).toBe(
      '/images/catalog/cards/asia/sv01-001/zh-tw/low.webp'
    );
  });

  it('is null when no language has a scan', () => {
    expect(displayImage(card({ en: null, de: null }), 'de', 'low')).toBeNull();
  });
});
