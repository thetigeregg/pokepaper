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
 * Image requests per client per minute. Above the global API limit: a set
 * grid or an offline set download legitimately loads hundreds at once (the
 * app caches each image, so this is a first-view cost).
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

/** Sets a revalidation ETag; true (with a 304 sent) when the client's copy is current. */
function notModified(request: FastifyRequest, reply: FastifyReply, etag: string): boolean {
  reply.header('cache-control', 'private, no-cache').header('etag', etag);
  const sent = request.headers['if-none-match'];
  if (sent?.split(',').some((candidate) => candidate.trim() === etag)) {
    void reply.code(304).send();
    return true;
  }
  return false;
}

/**
 * Catalogue download API (docs/catalog.md → Download API). Every route needs
 * a session, like the rest of the API.
 *
 * - `GET /api/catalog/manifest`: all series and a hash per set.
 * - `GET /api/catalog/sets/:region/:setId`: one set with all its cards.
 * - `GET /images/catalog/...`: card scans and set logos/symbols, fetched from
 *   TCGdex once and cached on disk. Only images the catalogue links are
 *   served, so this is never an open proxy to TCGdex.
 */
export function registerCatalogRoutes(app: FastifyInstance, options: CatalogRoutesOptions): void {
  const { store, images, languages } = options;

  app.get('/api/catalog/manifest', (request, reply) => {
    const manifest = store.manifest(languages);
    if (
      notModified(request, reply, `"catalog-${String(manifest.version)}-${languages.join('.')}"`)
    ) {
      return reply;
    }
    return manifest;
  });

  app.get<{ Params: { region: string; setId: string } }>(
    '/api/catalog/sets/:region/:setId',
    (request, reply) => {
      const { region, setId } = request.params;
      const pack = isRegion(region) && validId(setId) ? store.getSetPack(region, setId) : undefined;
      if (!pack) {
        return notFound(reply);
      }
      if (notModified(request, reply, `"${pack.hash}"`)) {
        return reply;
      }
      return pack;
    }
  );

  const imageRoute = {
    config: { rateLimit: { max: CATALOG_IMAGE_RATE_LIMIT, timeWindow: '1 minute' } },
  };

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
      const image = store.getCard(region, cardId)?.text[language]?.image;
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
