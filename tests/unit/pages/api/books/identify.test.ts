import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/lib/books/googleBooks', () => ({ searchGoogleBooks: vi.fn() }));
vi.mock('../../../../../src/lib/books/openLibrary', () => ({
  searchOpenLibrary: vi.fn(),
  searchOpenLibraryByTitle: vi.fn(),
}));
vi.mock('../../../../../src/lib/books/nationalLibrary', () => ({ searchNationalLibrary: vi.fn() }));

import { POST } from '../../../../../src/pages/api/books/[id]/identify';
import { searchGoogleBooks } from '../../../../../src/lib/books/googleBooks';
import {
  searchOpenLibrary,
  searchOpenLibraryByTitle,
} from '../../../../../src/lib/books/openLibrary';
import { searchNationalLibrary } from '../../../../../src/lib/books/nationalLibrary';

const BOOK_ID = '00000000-0000-4000-8000-000000000050';
type ApiJson = { data?: Record<string, unknown>; error?: { code: string; message: string } };

function makeContext(opts: {
  id?: string;
  body?: unknown;
  bookExists?: boolean;
  updateError?: { code?: string; name: string; message: string } | null;
  /** S-17: przechwytuje payloady update() do asercji propagacji pól. */
  updateCalls?: unknown[];
}) {
  const book = opts.bookExists === false ? null : { id: BOOK_ID };
  const updateSingle = vi
    .fn()
    .mockResolvedValue(
      opts.updateError
        ? { data: null, error: opts.updateError }
        : {
            data: {
              id: BOOK_ID,
              title: 'Nowy',
              authors: ['A'],
              cover_url: 'https://c.jpg',
              cover_source: 'auto',
            },
            error: null,
          },
    );
  const fromMock = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: book, error: null }) })),
    })),
    update: vi.fn((payload: unknown) => {
      opts.updateCalls?.push(payload);
      return { eq: vi.fn(() => ({ select: vi.fn(() => ({ single: updateSingle })) })) };
    }),
  }));
  return {
    params: { id: opts.id ?? BOOK_ID },
    request: { json: vi.fn().mockResolvedValue(opts.body) },
    locals: {
      user: { id: 'u1', email: 't@t.com' },
      supabase: { from: fromMock } as never,
    },
  } as never;
}

const GB_CANDIDATE = {
  source: 'google_books' as const,
  externalId: 'gb-1',
  title: 'Solaris',
  authors: ['Stanisław Lem'],
  isbn10: null,
  isbn13: '9780156027601',
  publisher: 'Harvest',
  publishedYear: 1961,
  coverUrl: 'https://gb/cover.jpg',
  description: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(searchGoogleBooks).mockResolvedValue({ ok: false, reason: 'empty' });
  vi.mocked(searchOpenLibraryByTitle).mockResolvedValue({ ok: false, reason: 'empty' });
  vi.mocked(searchNationalLibrary).mockResolvedValue({ ok: false, reason: 'empty' });
  vi.mocked(searchOpenLibrary).mockResolvedValue({ ok: false, reason: 'empty' });
});

describe('POST /api/books/[id]/identify', () => {
  it('401 gdy brak użytkownika', async () => {
    const ctx = makeContext({ body: { mode: 'search', title: 'X' } }) as {
      locals: { user: unknown };
    };
    ctx.locals.user = null;
    const res = await POST(ctx as never);
    expect(res.status).toBe(401);
  });

  it('404 gdy id nie jest UUID', async () => {
    const res = await POST(makeContext({ id: 'bad', body: { mode: 'search', title: 'X' } }));
    expect(res.status).toBe(404);
  });

  it('400 gdy zły mode', async () => {
    const res = await POST(makeContext({ body: { mode: 'xxx', title: 'X' } }));
    expect(res.status).toBe(400);
  });

  it('404 gdy książka nie istnieje', async () => {
    const res = await POST(
      makeContext({ body: { mode: 'search', title: 'Solaris' }, bookExists: false }),
    );
    expect(res.status).toBe(404);
  });

  it('search: zwraca kandydatów (GB)', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({ ok: true, candidates: [GB_CANDIDATE] });
    const res = await POST(
      makeContext({ body: { mode: 'search', title: 'Solaris', author: 'Lem' } }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect((json.data!.candidates as unknown[]).length).toBeGreaterThan(0);
  });

  it('apply: aktualizuje książkę i zwraca applied', async () => {
    const res = await POST(
      makeContext({
        body: {
          mode: 'apply',
          candidate: {
            title: 'Solaris',
            authors: ['Lem'],
            isbn13: '9780156027601',
            coverUrl: 'https://gb/cover.jpg',
            source: 'google_books',
            externalId: 'gb-1',
          },
        },
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!.applied).toBe(true);
  });

  it('apply: 400 przy duplikacie ISBN (23505)', async () => {
    const res = await POST(
      makeContext({
        body: {
          mode: 'apply',
          candidate: { title: 'Solaris', authors: ['Lem'], isbn13: '9780156027601' },
        },
        updateError: { code: '23505', name: 'PostgrestError', message: 'duplicate' },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('apply: 400 gdy candidate bez tytułu', async () => {
    const res = await POST(
      makeContext({ body: { mode: 'apply', candidate: { authors: ['Lem'] } } }),
    );
    expect(res.status).toBe(400);
  });

  // S-17: propagacja opisu kandydata do UPDATE books
  it('apply: przenosi description kandydata do update', async () => {
    const updateCalls: unknown[] = [];
    const res = await POST(
      makeContext({
        body: {
          mode: 'apply',
          candidate: {
            title: 'Solaris',
            authors: ['Lem'],
            isbn13: '9780156027601',
            source: 'google_books',
            externalId: 'gb-1',
            description: 'Stacja badawcza nad żywym oceanem.',
          },
        },
        updateCalls,
      }),
    );
    expect(res.status).toBe(200);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({ description: 'Stacja badawcza nad żywym oceanem.' });
  });

  it('apply: candidate bez opisu → description: null w update', async () => {
    const updateCalls: unknown[] = [];
    await POST(
      makeContext({
        body: { mode: 'apply', candidate: { title: 'Solaris', authors: ['Lem'] } },
        updateCalls,
      }),
    );
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({ description: null });
  });

  it('apply: odrzuca description dłuższy niż 2000 (400)', async () => {
    const res = await POST(
      makeContext({
        body: {
          mode: 'apply',
          candidate: { title: 'X', authors: [], description: 'a'.repeat(2001) },
        },
      }),
    );
    expect(res.status).toBe(400);
  });
});
