import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../../../../src/pages/api/books/search';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const SHELF_A = '00000000-0000-4000-8000-0000000000a1';
const BOOK_1 = '00000000-0000-4000-8000-0000000000b1';
const BOOK_2 = '00000000-0000-4000-8000-0000000000b2';

type ApiJson = {
  data?: { books: { id: string; shelf_name: string; spine_color: string | null }[]; total: number };
  error?: { code: string };
};

const entryRows = [
  { book_id: BOOK_1, shelf_id: SHELF_A, position_index: 1, photo_id: 'photo-uuid-1', shelves: { id: SHELF_A, name: 'Salon' } },
  { book_id: BOOK_2, shelf_id: SHELF_A, position_index: 2, photo_id: null, shelves: { id: SHELF_A, name: 'Salon' } },
];
const bookRows = [
  { id: BOOK_1, title: 'Solaris', authors: ['Lem'], cover_url: null, published_year: 1961, is_read: false, spine_color: 'niebieski', isbn_13: '9788373191723', isbn_10: null, publisher: 'Wydawnictwo Literackie' },
  { id: BOOK_2, title: 'Diuna', authors: ['Herbert'], cover_url: null, published_year: 1965, is_read: true, spine_color: 'czerwony', isbn_13: null, isbn_10: null, publisher: null },
];

/**
 * Mock buduje łańcuch dla 2 zapytań:
 *  - shelf_entries: select().eq('is_current',true)[.in('shelf_id',...)] → thenable
 *  - books: select().in('id',...)[.ilike][.eq] → .order() → thenable
 * Oba kończą się resolved value; budujemy chainable obiekt zwracający siebie + then.
 */
function chain(resolved: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'ilike', 'order']) {
    obj[m] = vi.fn(() => obj);
  }
  // await na obiekcie → resolved (thenable)
  obj.then = (onF: (v: unknown) => unknown) => Promise.resolve(resolved).then(onF);
  return obj;
}

function makeContext(opts: {
  user?: boolean;
  params?: string; // query string
  entries?: { data: unknown; error: unknown };
  books?: { data: unknown; error: unknown };
}) {
  const entriesChain = chain(opts.entries ?? { data: entryRows, error: null });
  const booksChain = chain(opts.books ?? { data: bookRows, error: null });
  const fromMock = vi.fn((table: string) => {
    if (table === 'shelf_entries') return entriesChain;
    if (table === 'books') return booksChain;
    return {};
  });
  return {
    url: new URL(`http://localhost/api/books/search${opts.params ?? ''}`),
    locals: {
      user: opts.user !== false ? { id: USER_ID, email: 't@test' } : null,
      supabase: { from: fromMock } as never,
    },
  } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/books/search', () => {
  it('401 gdy brak użytkownika', async () => {
    const res = await GET(makeContext({ user: false }));
    expect(res.status).toBe(401);
  });

  it('400 gdy kolor spoza palety', async () => {
    const res = await GET(makeContext({ params: '?color=turkusowy' }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('VALIDATION_ERROR');
  });

  it('200 bez filtrów → wszystkie książki z nazwą półki + kolorem', async () => {
    const res = await GET(makeContext({}));
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!.total).toBe(2);
    expect(json.data!.books[0]).toMatchObject({ id: BOOK_1, shelf_name: 'Salon', spine_color: 'niebieski', photo_id: 'photo-uuid-1', isbn_13: '9788373191723', publisher: 'Wydawnictwo Literackie' });
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('200 pusta lista gdy brak aktualnych wpisów półkowych', async () => {
    const res = await GET(makeContext({ entries: { data: [], error: null } }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!.total).toBe(0);
    expect(json.data!.books).toEqual([]);
  });

  it('akceptuje filtr q + color + read + shelf (kombinacja) → 200', async () => {
    const res = await GET(makeContext({ params: `?q=smok&color=czerwony&read=unread&shelf=${SHELF_A}` }));
    expect(res.status).toBe(200);
  });

  it('500 gdy shelf_entries error', async () => {
    const res = await GET(makeContext({ entries: { data: null, error: { name: 'E', message: 'x', code: 'XX' } } }));
    expect(res.status).toBe(500);
  });

  it('500 gdy books error', async () => {
    const res = await GET(makeContext({ books: { data: null, error: { name: 'E', message: 'x', code: 'XX' } } }));
    expect(res.status).toBe(500);
  });
});
