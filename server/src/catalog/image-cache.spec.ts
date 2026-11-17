import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CatalogImageCache, ImageUnavailableError, isWebp } from './image-cache.js';
import { Bytes, fakeTcgdex, Status, webp } from './test-helpers.js';

function cache(routes: Record<string, unknown>) {
  const fake = fakeTcgdex(routes);
  const dir = mkdtempSync(join(tmpdir(), 'pokepaper-images-'));
  return { fake, dir, images: new CatalogImageCache({ dir, fetch: fake.fetch }) };
}

describe('isWebp', () => {
  it('recognizes the RIFF/WEBP signature', () => {
    expect(isWebp(webp())).toBe(true);
    expect(isWebp(new TextEncoder().encode('<html>not an image</html>'))).toBe(false);
    expect(isWebp(new Uint8Array(4))).toBe(false);
  });
});

describe('CatalogImageCache', () => {
  it('fetches an image once, then serves it from disk', async () => {
    const image = webp(100);
    const { fake, images } = cache({ 'asset:fr/sv/sv01/001/low.webp': new Bytes(image) });

    const first = await images.file('fr/sv/sv01/001/low.webp');
    const second = await images.file('fr/sv/sv01/001/low.webp');

    expect(first).toBe(second);
    expect(new Uint8Array(readFileSync(first as string))).toEqual(image);
    expect(fake.calls).toEqual(['asset:fr/sv/sv01/001/low.webp']);
  });

  it('shares one fetch between concurrent requests for the same image', async () => {
    const { fake, images } = cache({ 'asset:a/b/c/low.webp': new Bytes(webp()) });

    await Promise.all([images.file('a/b/c/low.webp'), images.file('a/b/c/low.webp')]);

    expect(fake.calls).toHaveLength(1);
  });

  it('keeps case-different paths apart', async () => {
    const { images } = cache({
      'asset:zh-cn/CSM/CSM1aC/1/low.webp': new Bytes(webp(20)),
      'asset:zh-cn/CSM/csm1a/1/low.webp': new Bytes(webp(30)),
    });

    const upper = await images.file('zh-cn/CSM/CSM1aC/1/low.webp');
    const lower = await images.file('zh-cn/CSM/csm1a/1/low.webp');

    expect(upper).not.toBe(lower);
  });

  it('returns null when TCGdex has no such image', async () => {
    const { images } = cache({});

    await expect(images.file('ja/SV/SV2a/999/low.webp')).resolves.toBeNull();
  });

  it.each([
    ['answers with an error', new Status(503), /HTTP 503/],
    [
      'sends something that is not WebP',
      new Bytes(new TextEncoder().encode('<html>'), 'text/html'),
      /not a WebP/,
    ],
    ['sends an oversized body', new Bytes(webp(3 * 1024 * 1024)), /larger than/],
  ])('refuses to cache when TCGdex %s', async (_case, route, message) => {
    const { dir, images } = cache({ 'asset:a/b/c/low.webp': route });

    await expect(images.file('a/b/c/low.webp')).rejects.toThrow(message);
    await expect(images.file('a/b/c/low.webp')).rejects.toBeInstanceOf(ImageUnavailableError);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('reports network failures as unavailable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pokepaper-images-'));
    const images = new CatalogImageCache({
      dir,
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    });

    await expect(images.file('a/b/c/low.webp')).rejects.toThrow(/fetch failed/);
  });
});
