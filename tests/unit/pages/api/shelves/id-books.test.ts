import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../../../../src/pages/api/shelves/[id]/books';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const SHELF_ID = '00000000-0000-4000-8000-000000000040';

type PgError = { code?: string; name: string; message: string } | null;

type BookRow = {
  id: string; title: string; authors: string[];
  cover_url: string | null; published_year: number | null; is_read: boolean;
  isbn_13: string | null; isbn_10: string | null; publisher: string | null;
  user_cover_url: string | null; cover_photo_url: string | null; cover_source: 'auto' | 'url' | 'photo';
};
type EntryRow = { position_index: number | null; photo_id: string | null; books: BookRow | null };

function makeContext(opts: {
  id?: string;
  shelfResult?: { data: { id: string } | null; error: PgError };
  entryRows?: EntryRow[];
  entryError?: PgError;
  user?: boolean;
}) {
  const shelfResult = opts.shelfResult ?? { data: { id: SHELF_ID }, error: null };
  const entryRows = opts.entryRows ?? [];

  const fromMock = vi.fn((table: string) => {
    if (table === 'shelves') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue(shelfResult),
          })),
        })),
      };
    }
    if (table === 'shelf_entries') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({ data: entryRows, error: opts.entryError ?? null }),
            })),
          })),
        })),
      };
    }
    return {};
  });

  return {
    params: { id: opts.id ?? SHELF_ID },
    locals: {
      user: opts.user !== false ? { id: USER_ID, email: 'test@example.com' } : null,
      supabase: { from: fromMock } as never,
    },
  } as never;
}

const bookA: BookRow = {
  id: 'book-a', title: 'Solaris', authors: ['S. Lem'],
  cover_url: null, published_year: 1961, is_read: false,
  isbn_13: null, isbn_10: null, publisher: null,
  user_cover_url: null, cover_photo_url: null, cover_source: 'auto',
};
const bookB: BookRow = {
  id: 'book-b', title: 'Diuna', authors: ['F. Herbert'],
  cover_url: 'https://example.com/cover.jpg', published_year: 1965, is_read: true,
  isbn_13: '9788373191723', isbn_10: null, publisher: 'Rebis',
  user_cover_url: 'https://user.jpg', cover_photo_url: null, cover_source: 'url',
};

beforeEach(() => vi.clearAllMocks());

describe('GET /api/shelves/[id]/books', () => {
  it('401 gdy brak użytkownika', async () => {
    const ctx = makeContext({ user: false });
    const res = await GET(ctx);
    expect(res.status).toBe(401);
  });

  it('404 gdy id nie jest UUID', async () => {
    const ctx = makeContext({ id: 'not-a-uuid' });
    const res = await GET(ctx);
    expect(res.status).toBe(404);
  });

  it('404 gdy półka nie istnieje (RLS lub brak)', async () => {
    const ctx = makeContext({ shelfResult: { data: null, error: null } });
    const res = await GET(ctx);
    expect(res.status).toBe(404);
  });

  it('200 pusta lista gdy brak książek', async () => {
    const ctx = makeContext({ entryRows: [] });
    const res = await GET(ctx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { books: unknown[] } };
    expect(json.data.books).toHaveLength(0);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('200 zwraca książki w kolejności position_index', async () => {
    const entryRows: EntryRow[] = [
      { position_index: 1, photo_id: null, books: bookA },
      { position_index: 2, photo_id: 'photo-uuid-1', books: bookB },
    ];
    const ctx = makeContext({ entryRows });
    const res = await GET(ctx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { books: { id: string; title: string; position_index: number | null; is_read: boolean; photo_id: string | null }[] }
    };
    expect(json.data.books).toHaveLength(2);
    expect(json.data.books[0]).toMatchObject({ id: 'book-a', title: 'Solaris', position_index: 1, is_read: false, photo_id: null });
    expect(json.data.books[1]).toMatchObject({ id: 'book-b', title: 'Diuna', position_index: 2, is_read: true, photo_id: 'photo-uuid-1' });
  });

  it('mapuje ShelfBookDTO prawidłowo (cover_url, authors, published_year)', async () => {
    const ctx = makeContext({ entryRows: [{ position_index: 1, photo_id: null, books: bookB }] });
    const res = await GET(ctx);
    const json = (await res.json()) as {
      data: { books: { cover_url: string | null; authors: string[]; published_year: number | null; isbn_13: string | null; publisher: string | null; user_cover_url: string | null; cover_source: string }[] }
    };
    const book = json.data.books[0];
    expect(book.cover_url).toBe('https://example.com/cover.jpg');
    expect(book.isbn_13).toBe('9788373191723');
    expect(book.publisher).toBe('Rebis');
    expect(book.user_cover_url).toBe('https://user.jpg');
    expect(book.cover_source).toBe('url');
    expect(book.authors).toEqual(['F. Herbert']);
    expect(book.published_year).toBe(1965);
  });

  it('filtruje wiersze bez books (null join)', async () => {
    const entryRows: EntryRow[] = [
      { position_index: 1, photo_id: null, books: bookA },
      { position_index: 2, photo_id: null, books: null }, // CASCADE delete remnant
    ];
    const ctx = makeContext({ entryRows });
    const res = await GET(ctx);
    const json = (await res.json()) as { data: { books: unknown[] } };
    expect(json.data.books).toHaveLength(1);
  });
});
