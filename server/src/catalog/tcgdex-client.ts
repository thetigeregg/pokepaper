import { setTimeout as delay } from 'node:timers/promises';
import type { CatalogLanguage } from '@pokepaper/shared';

export const TCGDEX_API_BASE = 'https://api.tcgdex.net/v2';
export const TCGDEX_ASSET_BASE = 'https://assets.tcgdex.net/';
export const TCGDEX_USER_AGENT = 'PokePaper (+https://github.com/thetigeregg/pokepaper)';

/** Responses larger than this are refused (the biggest set detail is ~100 KB). */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export interface TcgdexClientOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
  /** Asset host for `assetExists` (tests point it elsewhere). */
  assetBaseUrl?: string;
  /** Requests in flight at once. Kept low: TCGdex is a free community API. */
  concurrency?: number;
  /** Attempts per request, including the first. */
  maxAttempts?: number;
  timeoutMs?: number;
  /** Waits between retries; must reject when `signal` aborts. Injected in tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Aborts queued and in-flight requests (graceful shutdown). */
  signal?: AbortSignal;
}

/** A request that kept failing for a reason that may go away (network, 5xx, 429). */
export class TcgdexUnavailableError extends Error {
  override readonly name = 'TcgdexUnavailableError';
}

/** A response that retrying won't fix (4xx other than 404/429, oversized, not JSON). */
export class TcgdexResponseError extends Error {
  override readonly name = 'TcgdexResponseError';
}

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  delay(ms, undefined, { signal });

/** Aborts when any of the given signals does. */
function anySignal(...signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const present = signals.filter((signal) => signal !== undefined);
  return present.length > 1 ? AbortSignal.any(present) : present[0];
}

/**
 * Minimal TCGdex REST client: GETs JSON with a concurrency limit, a timeout,
 * a size cap and retries with backoff. Returns `null` for 404. Responses are
 * returned as `unknown`: callers validate them (normalize.ts).
 */
export class TcgdexClient {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly assetBaseUrl: string;
  private readonly concurrency: number;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly signal: AbortSignal | undefined;
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  /** Requests made, including retries (for run stats). */
  requests = 0;

  constructor(options: TcgdexClientOptions = {}) {
    this.fetchFn = options.fetch ?? fetch;
    this.baseUrl = options.baseUrl ?? TCGDEX_API_BASE;
    this.assetBaseUrl = options.assetBaseUrl ?? TCGDEX_ASSET_BASE;
    this.concurrency = options.concurrency ?? 4;
    this.maxAttempts = options.maxAttempts ?? 4;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.sleep = options.sleep ?? defaultSleep;
    this.signal = options.signal;
  }

  series(language: CatalogLanguage, signal?: AbortSignal): Promise<unknown> {
    return this.get(`/${language}/series`, signal);
  }

  sets(language: CatalogLanguage, signal?: AbortSignal): Promise<unknown> {
    return this.get(`/${language}/sets`, signal);
  }

  set(language: CatalogLanguage, setId: string, signal?: AbortSignal): Promise<unknown> {
    return this.get(`/${language}/sets/${encodeURIComponent(setId)}`, signal);
  }

  card(language: CatalogLanguage, cardId: string, signal?: AbortSignal): Promise<unknown> {
    return this.get(`/${language}/cards/${encodeURIComponent(cardId)}`, signal);
  }

  /**
   * GETs `path` as JSON; `null` when TCGdex answers 404. `signal` cancels just
   * this request (queued, in flight or between retries), rejecting with its
   * reason; the client's own signal cancels every request.
   */
  async get(path: string, signal?: AbortSignal): Promise<unknown> {
    const combined = anySignal(this.signal, signal);
    await this.acquire();
    try {
      const response = await this.request(`${this.baseUrl}${path}`, 'GET', path, combined);
      return response ? await readJson(response, path) : null;
    } finally {
      this.release();
    }
  }

  /**
   * Whether TCGdex's asset host has `path` (e.g. `ja/SV/SV2a/001/low.webp`),
   * checked with a HEAD request.
   */
  async assetExists(path: string, signal?: AbortSignal): Promise<boolean> {
    const combined = anySignal(this.signal, signal);
    await this.acquire();
    try {
      const response = await this.request(`${this.assetBaseUrl}${path}`, 'HEAD', path, combined);
      await response?.body?.cancel();
      return response !== null;
    } finally {
      this.release();
    }
  }

  /** Sends one request with retries. Returns the OK response (body unread), or null for 404. */
  private async request(
    url: string,
    method: 'GET' | 'HEAD',
    path: string,
    signal: AbortSignal | undefined
  ): Promise<Response | null> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      signal?.throwIfAborted();
      let retryAfterMs: number | null = null;

      try {
        this.requests += 1;
        const response = await this.fetchFn(url, {
          method,
          headers: { accept: 'application/json', 'user-agent': TCGDEX_USER_AGENT },
          signal: anySignal(signal, AbortSignal.timeout(this.timeoutMs)),
        });

        if (response.status === 404) {
          await response.body?.cancel();
          return null;
        }
        if (response.ok) {
          return response;
        }

        await response.body?.cancel();
        if (response.status !== 429 && response.status < 500) {
          // Any other 4xx won't change on retry.
          throw new TcgdexResponseError(`TCGdex ${path}: HTTP ${String(response.status)}`);
        }
        lastError = new Error(`HTTP ${String(response.status)}`);
        retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
      } catch (error: unknown) {
        if (signal?.aborted) {
          throw signal.reason;
        }
        if (error instanceof TcgdexResponseError) {
          throw error;
        }
        lastError = error;
      }

      if (attempt < this.maxAttempts) {
        try {
          await this.sleep(retryAfterMs ?? 500 * 2 ** (attempt - 1), signal);
        } catch (error: unknown) {
          throw signal?.aborted ? signal.reason : error;
        }
      }
    }

    throw new TcgdexUnavailableError(
      `TCGdex ${path} failed after ${String(this.maxAttempts)} attempts: ${describe(lastError)}`
    );
  }

  private async acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      next(); // Hands the slot over directly; `active` stays the same.
    } else {
      this.active -= 1;
    }
  }
}

async function readJson(response: Response, path: string): Promise<unknown> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new TcgdexResponseError(`TCGdex ${path}: response too large (${String(declared)} bytes)`);
  }

  // Streamed, so a body without (or lying about) Content-Length can't be
  // buffered past the cap.
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body?.getReader();
  for (;;) {
    const chunk = reader ? await reader.read() : { done: true as const, value: undefined };
    if (chunk.done) {
      break;
    }
    size += chunk.value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader?.cancel();
      throw new TcgdexResponseError(`TCGdex ${path}: response too large`);
    }
    chunks.push(chunk.value);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new TcgdexResponseError(`TCGdex ${path}: invalid JSON`);
  }
}

/** `Retry-After` in seconds (capped at 60 s); HTTP-date values fall back to backoff. */
function parseRetryAfter(value: string | null): number | null {
  const seconds = Number(value);
  return value && Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 60) * 1000 : null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
