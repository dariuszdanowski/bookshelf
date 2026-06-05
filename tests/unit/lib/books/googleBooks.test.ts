import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ env: { GOOGLE_BOOKS_API_KEY: undefined } }));

import { searchGoogleBooks } from '../../../../src/lib/books/googleBooks';

const VALID_VOLUME = {
  id: 'abc123',
  volumeInfo: {
    title: 'Solaris',
    authors: ['Stanisław Lem'],
    publisher: 'Harvest Books',
    publishedDate: '1987',
    industryIdentifiers: [
      { type: 'ISBN_13', identifier: '9780156027601' },
      { type: 'ISBN_10', identifier: '0156027607' },
    ],
    imageLinks: { thumbnail: 'http://books.google.com/books/cover.jpg' },
  },
};

function makeOkResponse(items = [VALID_VOLUME]) {
  return new Response(JSON.stringify({ items }), { status: 200 });
}

// Factory functions — Response body can only be read once; recreate for each use
const makeEmptyResponse = () => new Response(JSON.stringify({ items: [] }), { status: 200 });
const makeRateLimitResponse = () => new Response('Too Many Requests', { status: 429 });
const makeServerErrorResponse = () => new Response('Internal Server Error', { status: 500 });

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('searchGoogleBooks', () => {
  it('returns mapped candidates on successful fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeOkResponse()));

    const result = await searchGoogleBooks({ title: 'Solaris', author: 'Lem' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].title).toBe('Solaris');
    expect(result.candidates[0].isbn13).toBe('9780156027601');
    expect(result.candidates[0].isbn10).toBe('0156027607');
    expect(result.candidates[0].source).toBe('google_books');
    // http → https upgrade for cover URL
    expect(result.candidates[0].coverUrl).toContain('https://');
  });

  it('cascades isbn → intitle+inauthor → free-text (stops on first non-empty)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 })) // isbn: empty
      .mockResolvedValueOnce(makeOkResponse()); // intitle+inauthor: hit

    vi.stubGlobal('fetch', fetchMock);

    const result = await searchGoogleBooks({ title: 'Solaris', author: 'Lem', isbn: '9780156027601' });

    expect(result.ok).toBe(true);
    // isbn call: 1, intitle+inauthor call: 2; free-text NOT called
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstUrl = decodeURIComponent(fetchMock.mock.calls[0][0] as string);
    expect(firstUrl).toContain('isbn:');
    const secondUrl = decodeURIComponent(fetchMock.mock.calls[1][0] as string);
    expect(secondUrl).toContain('intitle:');
  });

  it('reaches free-text fallback when isbn and intitle both empty', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeEmptyResponse()) // isbn: empty
      .mockResolvedValueOnce(makeEmptyResponse()) // intitle+inauthor: empty
      .mockResolvedValueOnce(makeOkResponse()); // free-text: hit

    vi.stubGlobal('fetch', fetchMock);

    const result = await searchGoogleBooks({ title: 'Solaris', author: 'Lem', isbn: '9780156027601' });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('returns rate_limited on 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeRateLimitResponse()));

    const result = await searchGoogleBooks({ title: 'Solaris' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('rate_limited');
  });

  it('stops cascade immediately on rate_limited', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(makeRateLimitResponse());
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchGoogleBooks({ title: 'Solaris', author: 'Lem', isbn: '9780156027601' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('rate_limited');
    expect(fetchMock).toHaveBeenCalledTimes(1); // no further cascade attempts
  });

  it('returns empty when items array is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeEmptyResponse()));

    const result = await searchGoogleBooks({ title: 'NoSuchBook' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('empty');
  });

  it('returns network on server error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeServerErrorResponse()));

    const result = await searchGoogleBooks({ title: 'Solaris' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('network');
  });

  it('returns network on fetch exception', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('Network down')));

    const result = await searchGoogleBooks({ title: 'Solaris' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('network');
  });

  it('validates Zod schema — returns network for unexpected shape', async () => {
    const badResponse = new Response(JSON.stringify({ items: [{ notAnId: 'x' }] }), { status: 200 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(badResponse));

    const result = await searchGoogleBooks({ title: 'Solaris' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('network');
  });

  it('falls back to inauthor-only when all title queries return empty and author known', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeEmptyResponse()) // intitle+inauthor: empty
      .mockResolvedValueOnce(makeEmptyResponse()) // free-text "Usterka na skraju": empty
      .mockResolvedValueOnce(makeOkResponse());   // inauthor:"Etgar Keret": hit

    vi.stubGlobal('fetch', fetchMock);

    const result = await searchGoogleBooks({ title: 'Usterka na skraju', author: 'Etgar Keret' });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const lastUrl = decodeURIComponent(fetchMock.mock.calls[2][0] as string);
    expect(lastUrl).toContain('inauthor:');
    expect(lastUrl).not.toContain('intitle:');
  });

  it('skips inauthor fallback when no author provided', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(makeEmptyResponse());
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchGoogleBooks({ title: 'NoSuchBook' });

    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only free-text, no inauthor attempt
  });

  it('skips isbn cascade step when no isbn provided', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(makeOkResponse());
    vi.stubGlobal('fetch', fetchMock);

    await searchGoogleBooks({ title: 'Solaris', author: 'Lem' });

    // Only intitle+inauthor called first (no isbn step)
    const url = decodeURIComponent(fetchMock.mock.calls[0][0] as string);
    expect(url).toContain('intitle:');
    expect(url).not.toContain('isbn:');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
