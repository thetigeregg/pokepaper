import { vi } from 'vitest';
import type { ImageCacheService } from './image-cache.service';
import { ImageSlot } from './image-slot';

describe('ImageSlot', () => {
  const resolve = vi.fn((url: string) => Promise.resolve<string | null>(`blob:${url}`));
  const release = vi.fn();
  const slot = () => new ImageSlot({ resolve, release } as unknown as ImageCacheService);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows an image, and releases it when replaced or cleared', async () => {
    const image = slot();

    expect(await image.show('a')).toBe('blob:a');
    expect(image.current).toBe('a');
    expect(await image.show('b')).toBe('blob:b');
    expect(release).toHaveBeenCalledWith('a');

    image.clear();
    expect(release).toHaveBeenCalledWith('b');
    expect(image.current).toBeNull();
  });

  it('keeps showing the same image without resolving it again', async () => {
    const image = slot();
    await image.show('a');

    expect(await image.show('a')).toBe('blob:a');
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
  });

  it('drops (and releases) a result a newer request superseded', async () => {
    let finishA: (src: string) => void = () => undefined;
    resolve.mockImplementationOnce(() => new Promise((done) => (finishA = done)));
    const image = slot();

    const first = image.show('a');
    expect(await image.show('b')).toBe('blob:b');
    finishA('blob:a');

    expect(await first).toBeUndefined();
    expect(release).toHaveBeenCalledWith('a');
    expect(image.current).toBe('b');
  });

  it('holds nothing for a missing image or a failed one', async () => {
    const image = slot();
    await image.show('a');
    resolve.mockResolvedValueOnce(null);

    expect(await image.show('missing')).toBeNull();
    expect(release).toHaveBeenCalledWith('a');
    expect(image.current).toBeNull();

    await image.show('b');
    resolve.mockRejectedValueOnce(new Error('offline'));
    await expect(image.show('c')).rejects.toThrow('offline');
    expect(release).toHaveBeenCalledWith('b');
    expect(image.current).toBeNull();
  });
});
