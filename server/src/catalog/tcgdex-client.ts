import type { CatalogLanguage } from '@pokepaper/shared';

export const TCGDEX_API_BASE = 'https://api.tcgdex.net/v2';
export const TCGDEX_USER_AGENT = 'PokePaper (+https://github.com/thetigeregg/pokepaper)';

/** Responses larger than this are refused (the biggest set detail is ~100 KB). */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export interface TcgdexClientOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
  /** Requests in flight at once. Kept low: TCGdex is a free community API. */
  concurrency?: number;
  /** Attempts per request, including the first. */
  maxAttempts?: number;
  timeoutMs?: number;
  /** Injected in tests so retries don't wait. */
  sleep?: (ms: number) => Promise<void>;
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

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Minimal TCGdex REST client: GETs JSON with a concurrency limit, a timeout,
 * a size cap and retries with backoff. Returns `null` for 404. Responses are
 * returned as `unknown`: callers validate them (normalize.ts).
 */
export class TcgdexClient {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly concurrency: number;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly signal: AbortSignal | undefined;
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  /** Requests made, including retries (for run stats). */
  requests = 0;

  constructor(options: TcgdexClientOptions = {}) {
    this.fetchFn = options.fetch ?? fetch;
    this.baseUrl = options.baseUrl ?? TCGDEX_API_BASE;
    this.concurrency = options.concurrency ?? 4;
    this.maxAttempts = options.maxAttempts ?? 4;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.sleep = options.sleep ?? defaultSleep;
    this.signal = options.signal;
  }

  series(language: CatalogLanguage): Promise<unknown> {
    return this.get(`/${language}/series`);
  }

  sets(language: CatalogLanguage): Promise<unknown> {
    return this.get(`/${language}/sets`);
  }

  set(language: CatalogLanguage, setId: string): Promise<unknown> {
    return this.get(`/${language}/sets/${encodeURIComponent(setId)}`);
  }

  card(language: CatalogLanguage, cardId: string): Promise<unknown> {
    return this.get(`/${language}/cards/${encodeURIComponent(cardId)}`);
  }

  /** GETs `path` as JSON; `null` when TCGdex answers 404. */
  async get(path: string): Promise<unknown> {
    await this.acquire();
    try {
      return await this.getWithRetry(path);
    } finally {
      this.release();
    }
  }

  private async getWithRetry(path: string): Promise<unknown> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      this.signal?.throwIfAborted();
      let retryAfterMs: number | null = null;

      try {
        this.requests += 1;
        const response = await this.fetchFn(`${this.baseUrl}${path}`, {
          headers: { accept: 'application/json', 'user-agent': TCGDEX_USER_AGENT },
          signal: this.signal
            ? AbortSignal.any([this.signal, AbortSignal.timeout(this.timeoutMs)])
            : AbortSignal.timeout(this.timeoutMs),
        });

        if (response.status === 404) {
          await response.body?.cancel();
          return null;
        }
        if (response.ok) {
          return await readJson(response, path);
        }

        await response.body?.cancel();
        if (response.status !== 429 && response.status < 500) {
          // Any other 4xx won't change on retry.
          throw new TcgdexResponseError(`TCGdex ${path}: HTTP ${String(response.status)}`);
        }
        lastError = new Error(`HTTP ${String(response.status)}`);
        retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
      } catch (error: unknown) {
        if (this.signal?.aborted) {
          throw this.signal.reason;
        }
        if (error instanceof TcgdexResponseError) {
          throw error;
        }
        lastError = error;
      }

      if (attempt < this.maxAttempts) {
        await this.sleep(retryAfterMs ?? 500 * 2 ** (attempt - 1));
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

  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new TcgdexResponseError(`TCGdex ${path}: response too large`);
  }
  try {
    return JSON.parse(text) as unknown;
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
