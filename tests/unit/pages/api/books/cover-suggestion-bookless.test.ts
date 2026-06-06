import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/lib/books/googleBooks', () => ({ searchGoogleBooks: vi.fn() }));

import { GET } from '../../../../../src/pages/api/books/cover-suggestion';
import { searchGoogleBooks } from '../../../../../src/lib/books/googleBooks';

type ApiJson = { data?: { cover_url: string | null }; error?: { code: string } };

function makeContext(opts: { isbn?: string; user?: boolean }) {
  const searchParams = new URLSearchParams();
  if (opts.isbn !== undefined) searchParams.set('isbn', opts.isbn);
  return {
    url: { searchParams },
    locals: {
      user: opts.user !== false ? { id: 'u1', email: 't@t.com' } : null,
    },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(searchGoogleBooks).mockResolvedValue({ ok: false, reason: 'empty' });
});

describe('GET /api/books/cover-suggestion (book-less)', () => {
  it('401 gdy brak użytkownika', async () => {
    const res = await GET(makeContext({ user: false, isbn: '9780156027601' }));
    expect(res.status).toBe(401);
  });

  it('400 gdy brak ISBN', async () => {
    const res = await GET(makeContext({}));
    expect(res.status).toBe(400);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('VALIDATION_ERROR');
  });

  it('400 gdy ISBN za krótki', async () => {
    const res = await GET(makeContext({ isbn: '123' }));
    expect(res.status).toBe(400);
  });

  it('OL ma okładkę → zwraca URL bez DB-write', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    const res = await GET(makeContext({ isbn: '9780156027601' }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!.cover_url).toContain('covers.openlibrary.org');
    // Brak DB-write — supabase nie musi być obecne w kontekście
  });

  it('OL brak, GB ma okładkę → zwraca GB URL', async () => {
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
          isbn13: '9780156027601',
          publisher: null,
          publishedYear: null,
          coverUrl: 'https://books.google.com/cover.jpg',
          description: null,
        },
      ],
    });
    const res = await GET(makeContext({ isbn: '9780156027601' }));
    const json = (await res.json()) as ApiJson;
    expect(json.data!.cover_url).toBe('https://books.google.com/cover.jpg');
  });

  it('ani OL ani GB → cover_url null', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
    const res = await GET(makeContext({ isbn: '9780156027601' }));
    const json = (await res.json()) as ApiJson;
    expect(json.data!.cover_url).toBeNull();
  });
});
