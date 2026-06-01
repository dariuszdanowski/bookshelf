import { describe, expect, it, vi } from 'vitest';

import { POST } from '../../../../../../src/pages/api/detections/[id]/rematch';

vi.mock('../../../../../../src/lib/books/googleBooks', () => ({
  searchGoogleBooks: vi.fn(),
}));
vi.mock('../../../../../../src/lib/books/openLibrary', () => ({
  searchOpenLibrary: vi.fn(),
}));

import { searchGoogleBooks } from '../../../../../../src/lib/books/googleBooks';
import { searchOpenLibrary } from '../../../../../../src/lib/books/openLibrary';

const DET_ID = '00000000-0000-4000-8000-000000000020';
const CAND_ID = '00000000-0000-4000-8000-000000000030';

type ApiJson = { data?: Record<string, unknown>; error?: { code: string; message: string } };

const MOCK_GOOGLE_CANDIDATE = {
  source: 'google_books' as const,
  externalId: 'gb-1',
  title: 'Przerwana kołysanka',
  authors: ['Natasza Socha'],
  isbn10: null,
  isbn13: '9788383100012',
  publisher: null,
  publishedYear: 2022,
  coverUrl: null,
};

function makeSupabase(opts: {
  detection?: { id: string; status: string } | null;
  existingCandidates?: { match_score: number; rank: number }[];
  existingBooks?: { id: string; title: string; authors: string[]; isbn_13: string | null; isbn_10: string | null }[];
  updateResult?: { error: null | { name: string; message: string; code?: string } };
  deleteResult?: { error: null | { name: string; message: string } };
  insertResult?: { data: { id: string }[] | null; error: null | { name: string; message: string } };
}) {
  const detection = opts.detection !== undefined ? opts.detection : { id: DET_ID, status: 'pending' };
  const existingCandidates = opts.existingCandidates ?? [];
  const existingBooks = opts.existingBooks ?? [];

  return {
    from: vi.fn((table: string) => {
      if (table === 'detections') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: detection, error: null }),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue(opts.updateResult ?? { error: null }),
          })),
        };
      }
      if (table === 'book_candidates') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: existingCandidates, error: null }),
          })),
          delete: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue(opts.deleteResult ?? { error: null }),
          })),
          insert: vi.fn(() => ({
            select: vi.fn().mockResolvedValue(
              opts.insertResult ?? { data: [{ id: CAND_ID, source: 'google_books', external_id: 'gb-1', title: 'Przerwana kołysanka', authors: ['Natasza Socha'], isbn_10: null, isbn_13: '9788383100012', publisher: null, published_year: 2022, cover_url: null, match_score: 0.95, rank: 1 }], error: null }
            ),
          })),
        };
      }
      if (table === 'books') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: existingBooks, error: null }),
          })),
        };
      }
      return {};
    }),
  };
}

function makeContext(opts: {
  id?: string;
  body?: unknown;
  user?: boolean;
  supabase?: ReturnType<typeof makeSupabase>;
}) {
  return {
    params: { id: opts.id ?? DET_ID },
    request: {
      json: vi.fn().mockResolvedValue(opts.body ?? { title: 'Przerwana kołysanka', author: 'Natasza Socha' }),
    },
    locals: {
      user: opts.user !== false ? { id: 'user-1', email: 'test@test.com' } : null,
      supabase: opts.supabase ?? makeSupabase({}),
    },
  } as never;
}

describe('POST /api/detections/[id]/rematch', () => {
  it('401 gdy brak użytkownika', async () => {
    const ctx = makeContext({ user: false });
    const res = await POST(ctx);
    expect(res.status).toBe(401);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('UNAUTHENTICATED');
  });

  it('404 gdy id nie jest UUID', async () => {
    const ctx = makeContext({ id: 'not-a-uuid' });
    const res = await POST(ctx);
    expect(res.status).toBe(404);
  });

  it('400 gdy pusty tytuł', async () => {
    const ctx = makeContext({ body: { title: '' } });
    const res = await POST(ctx);
    expect(res.status).toBe(400);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('VALIDATION_ERROR');
  });

  it('404 gdy detekcja nie istnieje', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({ ok: false, reason: 'empty' });
    const ctx = makeContext({ supabase: makeSupabase({ detection: null }) });
    const res = await POST(ctx);
    expect(res.status).toBe(404);
  });

  it('happy path — zwraca kandydatów z DB id gdy Google Books zwraca wyniki', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({ ok: true, candidates: [MOCK_GOOGLE_CANDIDATE] });
    vi.mocked(searchOpenLibrary).mockResolvedValue({ ok: false, reason: 'empty' });
    const ctx = makeContext({});
    const res = await POST(ctx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!['applied']).toBe(true);
    const candidates = json.data!['candidates'] as { id: string; matchScore: number }[];
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].id).toBe(CAND_ID);
    expect(candidates[0].matchScore).toBeGreaterThan(0.5);
  });

  it('applied: false gdy Google Books zwraca pustą listę', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({ ok: false, reason: 'empty' });
    const ctx = makeContext({});
    const res = await POST(ctx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!['applied']).toBe(false);
    expect((json.data!['candidates'] as unknown[]).length).toBe(0);
  });

  it('429 gdy Google Books rate limited', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({ ok: false, reason: 'rate_limited' });
    const ctx = makeContext({});
    const res = await POST(ctx);
    expect(res.status).toBe(429);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('RATE_LIMITED');
  });

  it('aktualizuje raw_title i raw_author w DB', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({ ok: true, candidates: [MOCK_GOOGLE_CANDIDATE] });
    vi.mocked(searchOpenLibrary).mockResolvedValue({ ok: false, reason: 'empty' });
    const supabase = makeSupabase({});
    const ctx = makeContext({ supabase, body: { title: 'Nowy Tytuł', author: 'Autor' } });
    await POST(ctx);
    const updateCall = vi.mocked(supabase.from).mock.calls.find(([t]) => t === 'detections');
    expect(updateCall).toBeTruthy();
  });
});
