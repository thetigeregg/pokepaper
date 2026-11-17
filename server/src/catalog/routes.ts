import { createReadStream } from 'node:fs';
import {
  CATALOG_REGIONS,
  isCatalogLanguage,
  type CatalogLanguage,
  type CatalogRegion,
} from '@pokepaper/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ImageUnavailableError, type CatalogImageCache } from './image-cache.js';
import type { CatalogStore } from './store.js';

/**
 * Catalog requests (packs and images) per client per minute. Above the
 * global API limit: a device's first catalog download is ~390 requests,
 * a set grid or an offline set download loads hundreds of images at once,
 * and devices at home share one public IP. The app keeps what it downloads,
 * so these are one-off costs.
 */
export const CATALOG_IMAGE_RATE_LIMIT = 3000;

const MAX_ID_LENGTH = 80;
const QUALITY_FILES: Readonly<Partial<Record<string, 'low' | 'high'>>> = {
  'low.webp': 'low',
  'high.webp': 'high',
};

export interface CatalogRoutesOptions {
  store: CatalogStore;
  images: CatalogImageCache;
  /** Languages the server imports (reported in the manifest). */
  languages: CatalogLanguage[];
}

function isRegion(value: string): value is CatalogRegion {
  return (CATALOG_REGIONS as readonly string[]).includes(value);
}

function validId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function notFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).send({ error: 'not_found' });
}

/**
 * Opaque part of an entity tag as a client may echo it: without the weak
 * marker (Cloudflare weakens tags it recompresses) and without a
 * compression suffix (Caddy appends `-gzip`/`-zstd` and strips it again on
 * the way in, but not from a weakened tag).
 */
function opaqueTag(tag: string): string {
  return tag
    .trim()
    .replace(/^W\//, '')
    .replace(/-(?:gzip|zstd|br)"$/, '"');
}

/** Whether `If-None-Match` matches `etag` (weak comparison, RFC 9110 §13.1.2). */
function matchesIfNoneMatch(request: FastifyRequest, etag: string): boolean {
  const sent = request.headers['if-none-match'];
  return (
    sent !== undefined &&
    sent.split(',').some((candidate) => candidate.trim() === '*' || opaqueTag(candidate) === etag)
  );
}

/** Revalidation headers, sent with full and 304 responses alike. */
function withETag(reply: FastifyReply, etag: string): FastifyReply {
  return reply.header('cache-control', 'private, no-cache').header('etag', etag);
}

/**
 * Catalog download API (docs/catalog.md → Download API). Every route needs
 * a session, like the rest of the API.
 *
 * - `GET /api/catalog/manifest`: all series and a hash per set.
 * - `GET /api/catalog/sets/:region/:setId`: one set with all its cards.
 * - `GET /images/catalog/...`: card scans and set logos/symbols, fetched from
 *   TCGdex once and cached on disk. Only images the catalog links are
 *   served, so this is never an open proxy to TCGdex.
 */
export function registerCatalogRoutes(app: FastifyInstance, options: CatalogRoutesOptions): void {
  const { store, images, languages } = options;

  const catalogRoute = {
    config: { rateLimit: { max: CATALOG_IMAGE_RATE_LIMIT, timeWindow: '1 minute' } },
  };

  const manifestTag = (version: number): string =>
    `"catalog-${String(version)}-${languages.join('.')}"`;

  // ETags are checked before anything is loaded, so update checks stay cheap.
  app.get('/api/catalog/manifest', catalogRoute, (request, reply) => {
    const current = manifestTag(store.version());
    if (matchesIfNoneMatch(request, current)) {
      return withETag(reply, current).code(304).send();
    }
    const manifest = store.manifest(languages);
    withETag(reply, manifestTag(manifest.version));
    return manifest;
  });

  app.get<{ Params: { region: string; setId: string } }>(
    '/api/catalog/sets/:region/:setId',
    catalogRoute,
    (request, reply) => {
      const { region, setId } = request.params;
      if (!isRegion(region) || !validId(setId)) {
        return notFound(reply);
      }
      const hash = store.getSetHash(region, setId);
      if (hash && matchesIfNoneMatch(request, `"${hash}"`)) {
        return withETag(reply, `"${hash}"`).code(304).send();
      }
      const pack = store.getSetPack(region, setId);
      if (!pack) {
        return notFound(reply);
      }
      withETag(reply, `"${pack.hash}"`);
      return pack;
    }
  );

  const imageRoute = catalogRoute;

  const sendImage = async (
    request: FastifyRequest,
    reply: FastifyReply,
    assetPath: string | null | undefined
  ): Promise<FastifyReply> => {
    if (!assetPath) {
      return notFound(reply);
    }
    let file: string | null;
    try {
      file = await images.file(assetPath);
    } catch (error: unknown) {
      if (!(error instanceof ImageUnavailableError)) {
        throw error;
      }
      request.log.warn({ err: error }, 'catalog.image_unavailable');
      return reply.code(502).send({ error: 'image_unavailable' });
    }
    if (!file) {
      return notFound(reply);
    }
    return reply
      .type('image/webp')
      .header('cache-control', 'private, max-age=604800')
      .send(createReadStream(file));
  };

  app.get<{ Params: { region: string; cardId: string; language: string; file: string } }>(
    '/images/catalog/cards/:region/:cardId/:language/:file',
    imageRoute,
    (request, reply) => {
      const { region, cardId, language, file } = request.params;
      const quality = QUALITY_FILES[file];
      if (!quality || !isRegion(region) || !validId(cardId) || !isCatalogLanguage(language)) {
        return notFound(reply);
      }
      const image = store.getCardImage(region, cardId, language);
      return sendImage(request, reply, image ? `${image}/${quality}.webp` : null);
    }
  );

  app.get<{ Params: { region: string; setId: string; file: string } }>(
    '/images/catalog/sets/:region/:setId/logo/:file',
    imageRoute,
    (request, reply) => {
      const { region, setId, file } = request.params;
      const language = file.endsWith('.webp') ? file.slice(0, -'.webp'.length) : '';
      if (!isRegion(region) || !validId(setId) || !isCatalogLanguage(language)) {
        return notFound(reply);
      }
      const logo = store.getSet(region, setId)?.set.logos[language];
      return sendImage(request, reply, logo ? `${logo}.webp` : null);
    }
  );

  app.get<{ Params: { region: string; setId: string } }>(
    '/images/catalog/sets/:region/:setId/symbol.webp',
    imageRoute,
    (request, reply) => {
      const { region, setId } = request.params;
      if (!isRegion(region) || !validId(setId)) {
        return notFound(reply);
      }
      const symbol = store.getSet(region, setId)?.set.symbol;
      return sendImage(request, reply, symbol ? `${symbol}.webp` : null);
    }
  );
}
