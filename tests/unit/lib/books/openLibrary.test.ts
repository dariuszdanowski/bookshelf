import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchOpenLibrary } from '../../../../src/lib/books/openLibrary';

const VALID_DOC = {
  key: '/works/OL123W',
  title: 'Solaris',
  author_name: ['Stanisław Lem'],
  first_publish_year: 1961,
  isbn: ['9780156027601', '0156027607'],
  cover_i: 12345,
  publisher: ['Harvest Books'],
};

function makeOkResponse(docs = [VALID_DOC]) {
  return new Response(JSON.stringify({ docs }), { status: 200 });
}

const emptyResponse = new Response(JSON.stringify({ docs: [] }), { status: 200 });
const rateLimitResponse = new Response('Too Many Requests', { status: 429 });

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('searchOpenLibrary', () => {
  it('returns empty immediately when no isbn provided', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchOpenLibrary({ title: 'Solaris' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('empty');
    expect(fetchMock).not.toHaveBeenCalled(); // no fetch for title-only queries
  });

  it('returns mapped candidates for isbn lookup', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeOkResponse()));

    const result = await searchOpenLibrary({ title: 'Solaris', isbn: '9780156027601' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].title).toBe('Solaris');
    expect(result.candidates[0].source).toBe('open_library');
    expect(result.candidates[0].isbn13).toBe('9780156027601');
    expect(result.candidates[0].isbn10).toBe('0156027607');
    expect(result.candidates[0].coverUrl).toContain('covers.openlibrary.org');
    expect(result.candidates[0].publishedYear).toBe(1961);
  });

  it('sends User-Agent header', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(makeOkResponse());
    vi.stubGlobal('fetch', fetchMock);

    await searchOpenLibrary({ title: 'Solaris', isbn: '9780156027601' });

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((opts?.headers as Record<string, string>)?.['User-Agent']).toBeTruthy();
  });

  it('strips hyphens from ISBN in query URL', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(makeOkResponse());
    vi.stubGlobal('fetch', fetchMock);

    await searchOpenLibrary({ title: 'Solaris', isbn: '978-0-15-602760-1' });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('isbn=9780156027601');
    expect(url).not.toContain('-');
  });

  it('returns rate_limited on 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(rateLimitResponse));

    const result = await searchOpenLibrary({ title: 'Solaris', isbn: '9780156027601' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('rate_limited');
  });

  it('returns empty when docs array is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(emptyResponse));

    const result = await searchOpenLibrary({ title: 'Solaris', isbn: '9780156027601' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('empty');
  });

  it('returns network on fetch exception', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('Network down')));

    const result = await searchOpenLibrary({ title: 'Solaris', isbn: '9780156027601' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('network');
  });

  it('handles missing cover_i gracefully', async () => {
    const docNoCover = { ...VALID_DOC } as Record<string, unknown>;
    delete docNoCover['cover_i'];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ docs: [docNoCover] }), { status: 200 })
    ));

    const result = await searchOpenLibrary({ title: 'Solaris', isbn: '9780156027601' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates[0].coverUrl).toBeNull();
  });
});
