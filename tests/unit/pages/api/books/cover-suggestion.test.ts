import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/lib/books/googleBooks', () => ({
  searchGoogleBooks: vi.fn(),
}));

import { GET } from '../../../../../src/pages/api/books/[id]/cover-suggestion';
import { searchGoogleBooks } from '../../../../../src/lib/books/googleBooks';

const BOOK_ID = '00000000-0000-4000-8000-000000000050';
type ApiJson = { data?: { cover_url: string | null }; error?: { code: string } };

function makeContext(opts: {
  id?: string;
  book?: { id: string; title: string; isbn_13: string | null; isbn_10: string | null } | null;
  user?: boolean;
}) {
  const book =
    opts.book !== undefined
      ? opts.book
      : { id: BOOK_ID, title: 'Solaris', isbn_13: '9788373191723', isbn_10: null };
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const fromMock = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: book, error: null }) })),
    })),
    update: vi.fn(() => ({ eq: updateEq })),
  }));
  return {
    params: { id: opts.id ?? BOOK_ID },
    locals: {
      user: opts.user !== false ? { id: 'u1', email: 't@t.com' } : null,
      supabase: { from: fromMock } as never,
    },
  } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/books/[id]/cover-suggestion', () => {
  it('401 gdy brak użytkownika', async () => {
    const res = await GET(makeContext({ user: false }));
    expect(res.status).toBe(401);
  });

  it('404 gdy id nie jest UUID', async () => {
    const res = await GET(makeContext({ id: 'bad' }));
    expect(res.status).toBe(404);
  });

  it('404 gdy książka nie istnieje', async () => {
    const res = await GET(makeContext({ book: null }));
    expect(res.status).toBe(404);
  });

  it('cover_url null gdy brak ISBN', async () => {
    const res = await GET(
      makeContext({ book: { id: BOOK_ID, title: 'X', isbn_13: null, isbn_10: null } }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!.cover_url).toBeNull();
  });

  it('OpenLibrary ma okładkę (HEAD 200) → zwraca OL URL', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    const res = await GET(makeContext({}));
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!.cover_url).toContain('covers.openlibrary.org');
    expect(json.data!.cover_url).toContain('9788373191723-L.jpg');
  });

  it('OL brak (404), GB ma okładkę → zwraca GB URL', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
    vi.mocked(searchGoogleBooks).mockResolvedValue({
      ok: true,
      candidates: [
        {
          source: 'google_books',
          externalId: 'gb',
          title: 'Solaris',
          authors: ['Lem'],
          isbn10: null,
          isbn13: '9788373191723',
          publisher: null,
          publishedYear: null,
          coverUrl: 'https://books.google.com/cover.jpg',
          description: null,
        },
      ],
    });
    const res = await GET(makeContext({}));
    const json = (await res.json()) as ApiJson;
    expect(json.data!.cover_url).toBe('https://books.google.com/cover.jpg');
  });

  it('ani OL ani GB → cover_url null', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
    vi.mocked(searchGoogleBooks).mockResolvedValue({ ok: false, reason: 'empty' });
    const res = await GET(makeContext({}));
    const json = (await res.json()) as ApiJson;
    expect(json.data!.cover_url).toBeNull();
  });
});
