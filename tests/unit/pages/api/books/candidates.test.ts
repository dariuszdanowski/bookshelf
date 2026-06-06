import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/lib/books/googleBooks', () => ({ searchGoogleBooks: vi.fn() }));
vi.mock('../../../../../src/lib/books/openLibrary', () => ({
  searchOpenLibrary: vi.fn(),
  searchOpenLibraryByTitle: vi.fn(),
}));
vi.mock('../../../../../src/lib/books/nationalLibrary', () => ({ searchNationalLibrary: vi.fn() }));

import { POST } from '../../../../../src/pages/api/books/candidates';
import { searchGoogleBooks } from '../../../../../src/lib/books/googleBooks';
import { searchOpenLibrary, searchOpenLibraryByTitle } from '../../../../../src/lib/books/openLibrary';
import { searchNationalLibrary } from '../../../../../src/lib/books/nationalLibrary';

type ApiJson = { data?: { candidates: unknown[] }; error?: { code: string; message: string } };

function makeContext(opts: { body?: unknown; user?: boolean }) {
  return {
    request: { json: vi.fn().mockResolvedValue(opts.body) },
    locals: {
      user: opts.user !== false ? { id: 'u1', email: 't@t.com' } : null,
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
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(searchGoogleBooks).mockResolvedValue({ ok: false, reason: 'empty' });
  vi.mocked(searchOpenLibraryByTitle).mockResolvedValue({ ok: false, reason: 'empty' });
  vi.mocked(searchNationalLibrary).mockResolvedValue({ ok: false, reason: 'empty' });
  vi.mocked(searchOpenLibrary).mockResolvedValue({ ok: false, reason: 'empty' });
});

describe('POST /api/books/candidates', () => {
  it('401 gdy brak użytkownika', async () => {
    const res = await POST(makeContext({ user: false, body: { title: 'X' } }));
    expect(res.status).toBe(401);
  });

  it('400 gdy brak tytułu i ISBN', async () => {
    const res = await POST(makeContext({ body: { author: 'ktoś' } }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('VALIDATION_ERROR');
  });

  it('400 gdy nieparsowalne body', async () => {
    const ctx = makeContext({ body: null });
    (ctx as { request: { json: ReturnType<typeof vi.fn> } }).request.json = vi.fn().mockRejectedValue(new Error('bad json'));
    const res = await POST(ctx);
    expect(res.status).toBe(400);
  });

  it('sam tytuł → zwraca kandydatów', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({ ok: true, candidates: [GB_CANDIDATE] });
    const res = await POST(makeContext({ body: { title: 'Solaris' } }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!.candidates.length).toBeGreaterThan(0);
  });

  it('tytuł + autor → zwraca kandydatów', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({ ok: true, candidates: [GB_CANDIDATE] });
    const res = await POST(makeContext({ body: { title: 'Solaris', author: 'Lem' } }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!.candidates.length).toBeGreaterThan(0);
  });

  it('sam ISBN → zwraca kandydatów (ISBN-first path, ominięcie gate 0.25)', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({ ok: true, candidates: [GB_CANDIDATE] });
    const res = await POST(makeContext({ body: { isbn: '9780156027601' } }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!.candidates.length).toBeGreaterThan(0);
  });

  it('429 gdy rate limited', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({ ok: false, reason: 'rate_limited' });
    const res = await POST(makeContext({ body: { title: 'X' } }));
    expect(res.status).toBe(429);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('RATE_LIMITED');
  });

  it('brak wyników → pusta lista kandydatów', async () => {
    const res = await POST(makeContext({ body: { title: 'Nieznana Książka XYZ' } }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!.candidates).toEqual([]);
  });
});
