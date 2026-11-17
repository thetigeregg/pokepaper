import { Status, fakeTcgdex } from './test-helpers.js';
import {
  TcgdexClient,
  TcgdexResponseError,
  TcgdexUnavailableError,
  TCGDEX_USER_AGENT,
} from './tcgdex-client.js';

function client(routes: Record<string, unknown>, sleeps: number[] = []) {
  const fake = fakeTcgdex(routes);
  return {
    fake,
    client: new TcgdexClient({
      fetch: fake.fetch,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    }),
  };
}

describe('TcgdexClient', () => {
  it('gets JSON from TCGdex with its own user agent', async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const fetchFn = (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      return Promise.resolve(Response.json([{ id: 'sv' }]));
    };
    const tcgdex = new TcgdexClient({ fetch: fetchFn as typeof fetch });

    await expect(tcgdex.series('fr')).resolves.toEqual([{ id: 'sv' }]);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://api.tcgdex.net/v2/fr/series');
    expect(requests[0]?.init?.headers).toMatchObject({ 'user-agent': TCGDEX_USER_AGENT });
  });

  it('builds paths for sets and cards, escaping IDs', async () => {
    const { fake, client: tcgdex } = client({});

    await tcgdex.sets('en');
    await tcgdex.set('zh-tw', 'SV2a');
    await tcgdex.card('en', 'sv03.5-001');

    expect(fake.calls).toEqual(['/en/sets', '/zh-tw/sets/SV2a', '/en/cards/sv03.5-001']);
  });

  it('checks whether an asset exists with HEAD requests', async () => {
    const requests: { url: string; method: string | undefined }[] = [];
    const fetchFn = (url: string, init?: RequestInit) => {
      requests.push({ url, method: init?.method });
      return Promise.resolve(new Response(null, { status: url.includes('/001/') ? 200 : 404 }));
    };
    const tcgdex = new TcgdexClient({ fetch: fetchFn as typeof fetch });

    await expect(tcgdex.assetExists('ja/SV/SV2a/001/low.webp')).resolves.toBe(true);
    await expect(tcgdex.assetExists('ja/SV/SV2a/999/low.webp')).resolves.toBe(false);
    expect(requests[0]).toEqual({
      url: 'https://assets.tcgdex.net/ja/SV/SV2a/001/low.webp',
      method: 'HEAD',
    });
  });

  it('returns null for 404', async () => {
    const { client: tcgdex } = client({});

    await expect(tcgdex.card('en', 'nope')).resolves.toBeNull();
  });

  it('retries server errors and rate limiting with backoff', async () => {
    const sleeps: number[] = [];
    let attempt = 0;
    const fetchFn = () => {
      attempt += 1;
      if (attempt === 1) {
        return Promise.resolve(new Response(null, { status: 503 }));
      }
      if (attempt === 2) {
        return Promise.resolve(
          new Response(null, { status: 429, headers: { 'retry-after': '3' } })
        );
      }
      return Promise.resolve(Response.json({ ok: true }));
    };
    const tcgdex = new TcgdexClient({
      fetch: fetchFn,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });

    await expect(tcgdex.get('/en/sets')).resolves.toEqual({ ok: true });

    expect(sleeps).toEqual([500, 3000]);
    expect(tcgdex.requests).toBe(3);
  });

  it('retries when the connection drops mid-body', async () => {
    let attempt = 0;
    const fetchFn = () => {
      attempt += 1;
      if (attempt === 1) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('[{"id":'));
            controller.error(new TypeError('terminated'));
          },
        });
        return Promise.resolve(new Response(body));
      }
      return Promise.resolve(Response.json([{ id: 'sv' }]));
    };
    const tcgdex = new TcgdexClient({
      fetch: fetchFn,
      sleep: () => Promise.resolve(),
    });

    await expect(tcgdex.get('/en/series')).resolves.toEqual([{ id: 'sv' }]);
    expect(attempt).toBe(2);
  });

  it('retries network errors, then gives up as unavailable', async () => {
    const sleeps: number[] = [];
    const tcgdex = new TcgdexClient({
      fetch: () => Promise.reject(new TypeError('fetch failed')),
      maxAttempts: 3,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });

    await expect(tcgdex.get('/en/sets')).rejects.toThrow(TcgdexUnavailableError);
    await expect(tcgdex.get('/en/sets')).rejects.toThrow(/after 3 attempts: fetch failed/);
    expect(sleeps.slice(0, 2)).toEqual([500, 1000]);
  });

  it('does not retry other client errors', async () => {
    const { fake, client: tcgdex } = client({ '/en/sets': new Status(400) });

    await expect(tcgdex.get('/en/sets')).rejects.toThrow(TcgdexResponseError);
    expect(fake.calls).toHaveLength(1);
  });

  it('rejects invalid JSON and oversized responses without retrying', async () => {
    const invalid = new TcgdexClient({
      fetch: () => Promise.resolve(new Response('<html>')),
    });
    const oversized = new TcgdexClient({
      fetch: () =>
        Promise.resolve(
          new Response('[]', { headers: { 'content-length': String(10 * 1024 * 1024) } })
        ),
    });

    await expect(invalid.get('/en/sets')).rejects.toThrow('invalid JSON');
    await expect(oversized.get('/en/sets')).rejects.toThrow('too large');
  });

  it('keeps at most `concurrency` requests in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchFn = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return Response.json({});
    };
    const tcgdex = new TcgdexClient({ fetch: fetchFn, concurrency: 3 });

    await Promise.all(
      Array.from({ length: 10 }, (_, index) => tcgdex.get(`/en/cards/${String(index)}`))
    );

    expect(peak).toBe(3);
  });

  it('stops waiting between retries as soon as it is aborted', async () => {
    const controller = new AbortController();
    const tcgdex = new TcgdexClient({
      fetch: () =>
        Promise.resolve(new Response(null, { status: 429, headers: { 'retry-after': '60' } })),
      signal: controller.signal,
    });
    const started = Date.now();
    setTimeout(() => {
      controller.abort(new Error('shutting down'));
    }, 20);

    await expect(tcgdex.get('/en/sets')).rejects.toThrow('shutting down');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('cancels a single request, even while it waits for a slot', async () => {
    let release: () => void = () => undefined;
    const calls: string[] = [];
    const fetchFn = async (url: string) => {
      calls.push(url);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return Response.json({});
    };
    const tcgdex = new TcgdexClient({ fetch: fetchFn as typeof fetch, concurrency: 1 });
    const cancel = new AbortController();

    const first = tcgdex.get('/en/cards/1');
    const queued = tcgdex.get('/en/cards/2', cancel.signal);
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    cancel.abort(new Error('set failed'));
    release();

    await expect(first).resolves.toEqual({});
    await expect(queued).rejects.toThrow('set failed');
    expect(calls).toHaveLength(1);
  });

  it('stops reading a body without Content-Length once it passes the cap', async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
    });
    const tcgdex = new TcgdexClient({
      fetch: () => Promise.resolve(new Response(body)),
    });

    await expect(tcgdex.get('/en/sets')).rejects.toThrow('too large');
    expect(pulled).toBeLessThan(10);
  });

  it('stops retrying once aborted', async () => {
    const controller = new AbortController();
    const tcgdex = new TcgdexClient({
      fetch: () => {
        controller.abort(new Error('shutting down'));
        return Promise.reject(new DOMException('aborted', 'AbortError'));
      },
      sleep: () => Promise.resolve(),
      signal: controller.signal,
    });

    await expect(tcgdex.get('/en/sets')).rejects.toThrow('shutting down');
    expect(tcgdex.requests).toBe(1);
  });
});
