import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BookSearchResult } from '../../../../src/lib/books/schema';

const OK_RESULT: BookSearchResult = {
  ok: true,
  candidates: [
    {
      source: 'google_books',
      externalId: 'abc123',
      title: 'Solaris',
      authors: ['Stanisław Lem'],
      isbn10: null,
      isbn13: null,
      publisher: null,
      publishedYear: null,
      coverUrl: null,
      description: null,
    },
  ],
};

const EMPTY_RESULT: BookSearchResult = { ok: false, reason: 'empty' };
const RATE_LIMITED_RESULT: BookSearchResult = { ok: false, reason: 'rate_limited' };
const NETWORK_RESULT: BookSearchResult = { ok: false, reason: 'network' };

function makeMockKv() {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('withApiCache — brak bindingu (env: {})', () => {
  it('zawsze woła fetcher, zero wywołań kv.get/kv.put', async () => {
    vi.doMock('cloudflare:workers', () => ({ env: {} }));
    const { withApiCache } = await import('../../../../src/lib/books/apiCache');

    const fetcher = vi.fn().mockResolvedValue(OK_RESULT);
    const result = await withApiCache('https://example.com/q', fetcher);

    expect(result).toEqual(OK_RESULT);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('withApiCache — z bindingiem KV', () => {
  it('hit zwraca zdeserializowany wynik bez wołania fetchera', async () => {
    const kv = makeMockKv();
    kv.get.mockResolvedValueOnce(OK_RESULT);
    vi.doMock('cloudflare:workers', () => ({ env: { BOOK_API_CACHE_KV: kv } }));
    const { withApiCache } = await import('../../../../src/lib/books/apiCache');

    const fetcher = vi.fn().mockResolvedValue(EMPTY_RESULT);
    const result = await withApiCache('https://example.com/q', fetcher);

    expect(result).toEqual(OK_RESULT);
    expect(fetcher).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('miss woła fetcher i zapisuje ok:true z TTL 30 dni, prefiksuje kluczem wersji', async () => {
    const kv = makeMockKv();
    vi.doMock('cloudflare:workers', () => ({ env: { BOOK_API_CACHE_KV: kv } }));
    const { withApiCache, CACHE_TTL_OK_SECONDS } =
      await import('../../../../src/lib/books/apiCache');

    const fetcher = vi.fn().mockResolvedValue(OK_RESULT);
    const result = await withApiCache('https://example.com/q', fetcher);

    expect(result).toEqual(OK_RESULT);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(kv.get).toHaveBeenCalledWith('v1:https://example.com/q', 'json');
    expect(kv.put).toHaveBeenCalledWith('v1:https://example.com/q', JSON.stringify(OK_RESULT), {
      expirationTtl: CACHE_TTL_OK_SECONDS,
    });
  });

  it('miss z reason:empty zapisuje z TTL 1 dnia', async () => {
    const kv = makeMockKv();
    vi.doMock('cloudflare:workers', () => ({ env: { BOOK_API_CACHE_KV: kv } }));
    const { withApiCache, CACHE_TTL_EMPTY_SECONDS } =
      await import('../../../../src/lib/books/apiCache');

    const fetcher = vi.fn().mockResolvedValue(EMPTY_RESULT);
    const result = await withApiCache('https://example.com/q', fetcher);

    expect(result).toEqual(EMPTY_RESULT);
    expect(kv.put).toHaveBeenCalledWith('v1:https://example.com/q', JSON.stringify(EMPTY_RESULT), {
      expirationTtl: CACHE_TTL_EMPTY_SECONDS,
    });
  });

  it('rate_limited nie jest zapisywany do KV', async () => {
    const kv = makeMockKv();
    vi.doMock('cloudflare:workers', () => ({ env: { BOOK_API_CACHE_KV: kv } }));
    const { withApiCache } = await import('../../../../src/lib/books/apiCache');

    const fetcher = vi.fn().mockResolvedValue(RATE_LIMITED_RESULT);
    const result = await withApiCache('https://example.com/q', fetcher);

    expect(result).toEqual(RATE_LIMITED_RESULT);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('network nie jest zapisywany do KV', async () => {
    const kv = makeMockKv();
    vi.doMock('cloudflare:workers', () => ({ env: { BOOK_API_CACHE_KV: kv } }));
    const { withApiCache } = await import('../../../../src/lib/books/apiCache');

    const fetcher = vi.fn().mockResolvedValue(NETWORK_RESULT);
    const result = await withApiCache('https://example.com/q', fetcher);

    expect(result).toEqual(NETWORK_RESULT);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('błąd kv.get (throw) nie przerywa requestu — traktowany jak miss', async () => {
    const kv = makeMockKv();
    kv.get.mockRejectedValueOnce(new Error('KV read failed'));
    vi.doMock('cloudflare:workers', () => ({ env: { BOOK_API_CACHE_KV: kv } }));
    const { withApiCache } = await import('../../../../src/lib/books/apiCache');

    const fetcher = vi.fn().mockResolvedValue(OK_RESULT);
    const result = await withApiCache('https://example.com/q', fetcher);

    expect(result).toEqual(OK_RESULT);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('błąd kv.put (throw) nie przerywa requestu — wynik zwrócony mimo braku zapisu', async () => {
    const kv = makeMockKv();
    kv.put.mockRejectedValueOnce(new Error('KV write failed'));
    vi.doMock('cloudflare:workers', () => ({ env: { BOOK_API_CACHE_KV: kv } }));
    const { withApiCache } = await import('../../../../src/lib/books/apiCache');

    const fetcher = vi.fn().mockResolvedValue(OK_RESULT);
    const result = await withApiCache('https://example.com/q', fetcher);

    expect(result).toEqual(OK_RESULT);
  });
});
