import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { access, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TCGDEX_ASSET_BASE, TCGDEX_USER_AGENT } from './tcgdex-client.js';

/** The largest scan (`high.webp`) is ~300 KB; anything far beyond isn't a card image. */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** TCGdex couldn't deliver the image right now (or delivered something that isn't one). */
export class ImageUnavailableError extends Error {
  override readonly name = 'ImageUnavailableError';
}

export interface CatalogImageCacheOptions {
  /** Directory for cached files (created if missing). */
  dir: string;
  fetch?: typeof fetch;
  assetBaseUrl?: string;
  timeoutMs?: number;
}

/**
 * Disk cache of TCGdex catalogue images. Each image is fetched from TCGdex's
 * asset host once, checked to really be a WebP image, and kept as
 * `<sha256 of its asset path>.webp` (hashed, so case-sensitive TCGdex paths
 * can't collide on a case-insensitive filesystem). Concurrent requests for
 * the same image share one fetch.
 *
 * Callers decide *which* asset paths are allowed (catalogue lookups in
 * routes.ts); this class never builds paths from request input itself.
 */
export class CatalogImageCache {
  private readonly dir: string;
  private readonly fetchFn: typeof fetch;
  private readonly assetBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly inFlight = new Map<string, Promise<string | null>>();

  constructor(options: CatalogImageCacheOptions) {
    this.dir = options.dir;
    this.fetchFn = options.fetch ?? fetch;
    this.assetBaseUrl = options.assetBaseUrl ?? TCGDEX_ASSET_BASE;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    mkdirSync(this.dir, { recursive: true });
  }

  /**
   * Local file holding the asset at `path` (e.g. `fr/sv/sv01/001/low.webp`),
   * fetching it on first use. Null when TCGdex doesn't have it.
   */
  file(path: string): Promise<string | null> {
    const file = join(this.dir, `${createHash('sha256').update(path).digest('hex')}.webp`);
    const pending = this.inFlight.get(file);
    if (pending) {
      return pending;
    }

    const load = this.load(path, file).finally(() => {
      this.inFlight.delete(file);
    });
    this.inFlight.set(file, load);
    return load;
  }

  private async load(path: string, file: string): Promise<string | null> {
    try {
      await access(file);
      return file;
    } catch {
      // Not cached yet.
    }

    let response: Response;
    try {
      response = await this.fetchFn(`${this.assetBaseUrl}${path}`, {
        headers: { 'user-agent': TCGDEX_USER_AGENT },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error: unknown) {
      throw new ImageUnavailableError(`TCGdex asset ${path}: ${describe(error)}`);
    }

    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ImageUnavailableError(`TCGdex asset ${path}: HTTP ${String(response.status)}`);
    }

    const bytes = await readCapped(response, path);
    // TCGdex labels some WebP files application/octet-stream, so check the
    // signature instead of the Content-Type.
    if (!isWebp(bytes)) {
      throw new ImageUnavailableError(`TCGdex asset ${path}: not a WebP image`);
    }

    // Write then rename, so a crash never leaves a truncated image behind.
    const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(temp, bytes);
      await rename(temp, file);
    } catch (error: unknown) {
      await rm(temp, { force: true });
      throw error;
    }
    return file;
  }
}

async function readCapped(response: Response, path: string): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body?.getReader();
  try {
    for (;;) {
      const chunk = reader ? await reader.read() : { done: true as const, value: undefined };
      if (chunk.done) {
        break;
      }
      size += chunk.value.byteLength;
      if (size > MAX_IMAGE_BYTES) {
        await reader?.cancel();
        throw new ImageUnavailableError(
          `TCGdex asset ${path}: larger than ${String(MAX_IMAGE_BYTES)} bytes`
        );
      }
      chunks.push(chunk.value);
    }
  } catch (error: unknown) {
    if (error instanceof ImageUnavailableError) {
      throw error;
    }
    throw new ImageUnavailableError(`TCGdex asset ${path}: ${describe(error)}`);
  }
  return Buffer.concat(chunks);
}

/** RIFF container with a WEBP form type. */
export function isWebp(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString('latin1') === 'RIFF' &&
    Buffer.from(bytes.subarray(8, 12)).toString('latin1') === 'WEBP'
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
