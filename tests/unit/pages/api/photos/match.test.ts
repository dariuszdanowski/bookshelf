import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSearchGoogleBooks = vi.hoisted(() => vi.fn());
const mockSearchOpenLibrary = vi.hoisted(() => vi.fn());

vi.mock('../../../../../src/lib/books/googleBooks', () => ({
  searchGoogleBooks: mockSearchGoogleBooks,
}));
vi.mock('../../../../../src/lib/books/openLibrary', () => ({
  searchOpenLibrary: mockSearchOpenLibrary,
}));

import { POST } from '../../../../../src/pages/api/photos/[id]/match';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const PHOTO_ID = '00000000-0000-4000-8000-000000000003';
const RUN_ID_1 = '00000000-0000-4000-8000-000000000090';
const RUN_ID_2 = '00000000-0000-4000-8000-000000000091';
const DET_ID_1 = '00000000-0000-4000-8000-000000000010';
const DET_ID_2 = '00000000-0000-4000-8000-000000000011';

const googleCandidate = {
  source: 'google_books' as const,
  externalId: 'gb-1',
  title: 'Solaris',
  authors: ['Stanisław Lem'],
  isbn10: '0156027607',
  isbn13: '9780156027601',
  publisher: 'Harvest Books',
  publishedYear: 1987,
  coverUrl: 'https://books.google.com/cover.jpg',
};

const detectionRow = {
  id: DET_ID_1,
  raw_title: 'Solaris',
  raw_author: 'Stanisław Lem',
  status: 'pending',
  position_index: 1,
};

// Latest succeeded run row returned by the vision_runs query
const latestRunRow = { id: RUN_ID_1 };

function makeSupabase(opts: {
  photoResult?: { data: { id: string } | null; error: { code?: string; name: string; message: string } | null };
  latestRunResult?: { data: { id: string } | null; error: { code?: string; name?: string; message?: string } | null };
  detectionsResult?: { data: typeof detectionRow[] | null; error: null };
  booksResult?: { data: { id: string; title: string; authors: string[]; isbn_13: string | null; isbn_10: string | null }[] | null; error: null };
  existingCandidatesResult?: {
    data:
      | {
          detection_id: string;
          source: string;
          external_id: string;
          title: string;
          authors: string[];
          isbn_10: string | null;
          isbn_13: string | null;
          publisher: string | null;
          published_year: number | null;
          cover_url: string | null;
          match_score: number;
          rank: number;
        }[]
      | null;
    error: { name: string; message: string; code?: string } | null;
  };
  deleteCandidatesError?: { name: string; message: string; code?: string } | null;
  insertCandidatesError?: { name: string; message: string; code?: string } | null;
  trackInsertions?: { candidates: unknown[][] };
  trackRunIdUsed?: { runId: string | null };
}) {
  const {
    photoResult = { data: { id: PHOTO_ID }, error: null },
    latestRunResult = { data: latestRunRow, error: null },
    detectionsResult = { data: [detectionRow], error: null },
    booksResult = { data: [], error: null },
    existingCandidatesResult = { data: [], error: null },
    deleteCandidatesError = null,
    insertCandidatesError = null,
    trackInsertions,
    trackRunIdUsed,
  } = opts;

  const fromFn = vi.fn((table: string) => {
    if (table === 'profiles') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: { ai_enabled: true }, error: null }),
          })),
        })),
      };
    }

    if (table === 'photos') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ single: vi.fn().mockResolvedValue(photoResult) })),
        })),
      };
    }

    if (table === 'vision_runs') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue(latestRunResult),
                })),
              })),
            })),
          })),
        })),
      };
    }

    if (table === 'detections') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((col: string, val: string) => {
            if (col === 'vision_run_id' && trackRunIdUsed) {
              trackRunIdUsed.runId = val;
            }
            return {
              neq: vi.fn().mockResolvedValue(detectionsResult),
            };
          }),
        })),
        update: vi.fn(() => ({
          in: vi.fn().mockResolvedValue({ error: null }),
        })),
      };
    }

    if (table === 'books') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue(booksResult),
        })),
      };
    }

    if (table === 'book_candidates') {
      return {
        select: vi.fn(() => ({
          in: vi.fn().mockResolvedValue(existingCandidatesResult),
        })),
        delete: vi.fn(() => ({
          in: vi.fn().mockResolvedValue({ error: deleteCandidatesError }),
        })),
        insert: vi.fn((rows: unknown[]) => {
          if (trackInsertions) trackInsertions.candidates.push(rows);
          return Promise.resolve({ error: insertCandidatesError });
        }),
      };
    }

    return {};
  });

  return {
    supabase: { from: fromFn } as never,
    fromFn,
  };
}

function makeContext(supabase: ReturnType<typeof makeSupabase>['supabase'], photoId = PHOTO_ID) {
  return {
    params: { id: photoId },
    locals: { supabase, user: { id: USER_ID } as never },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchGoogleBooks.mockResolvedValue({ ok: true, candidates: [googleCandidate] });
  mockSearchOpenLibrary.mockResolvedValue({ ok: false, reason: 'empty' });
});

describe('POST /api/photos/[id]/match', () => {
  it('returns 401 when not authenticated', async () => {
    const { supabase } = makeSupabase({});
    const ctx = { params: { id: PHOTO_ID }, locals: { supabase, user: null } };
    const res = await POST(ctx as never);
    expect(res.status).toBe(401);
  });

  it('returns 403 AI_DISABLED when profile.ai_enabled = false', async () => {
    const { supabase, fromFn } = makeSupabase({});
    fromFn.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: { ai_enabled: false }, error: null }),
            })),
          })),
        };
      }
      return {};
    });
    const res = await POST(makeContext(supabase) as never);
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('AI_DISABLED');
  });

  it('returns 404 for malformed UUID', async () => {
    const { supabase } = makeSupabase({});
    const ctx = makeContext(supabase, 'not-a-uuid');
    const res = await POST(ctx as never);
    expect(res.status).toBe(404);
  });

  it('returns 404 when photo not found (PGRST116)', async () => {
    const { supabase } = makeSupabase({
      photoResult: { data: null, error: { code: 'PGRST116', name: 'Err', message: 'no rows' } },
    });
    const res = await POST(makeContext(supabase) as never);
    expect(res.status).toBe(404);
  });

  it('returns 404 when no succeeded vision_run exists for photo', async () => {
    const { supabase } = makeSupabase({
      latestRunResult: { data: null, error: null },
    });
    const res = await POST(makeContext(supabase) as never);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('operates ONLY on detections from the latest succeeded run (run-scoped)', async () => {
    const trackRunIdUsed: { runId: string | null } = { runId: null };
    const { supabase } = makeSupabase({
      latestRunResult: { data: { id: RUN_ID_2 }, error: null },
      trackRunIdUsed,
    });

    await POST(makeContext(supabase) as never);
    // Must query detections by vision_run_id of the latest succeeded run, not by photo_id
    expect(trackRunIdUsed.runId).toBe(RUN_ID_2);
  });

  it('happy path: returns 200 with matched detections and candidates', async () => {
    const { supabase } = makeSupabase({});
    const res = await POST(makeContext(supabase) as never);

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { matched: number; detections: { status: string; candidates: { title: string }[] }[] };
    };
    expect(json.data.matched).toBe(1);
    expect(json.data.detections).toHaveLength(1);
    expect(json.data.detections[0].status).toBe('matched');
    expect(json.data.detections[0].candidates[0].title).toBe('Solaris');
  });

  it('idempotency: delete-then-insert on re-match', async () => {
    const trackInsertions: { candidates: unknown[][] } = { candidates: [] };
    const { supabase, fromFn } = makeSupabase({ trackInsertions });

    await POST(makeContext(supabase) as never);

    const deleteCalls = fromFn.mock.calls.filter(([t]) => t === 'book_candidates');
    expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
    expect(trackInsertions.candidates).toHaveLength(1);
  });

  it('graceful degrade: empty detections returns matched=0', async () => {
    const { supabase } = makeSupabase({
      detectionsResult: { data: [], error: null },
    });
    const res = await POST(makeContext(supabase) as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { matched: number } };
    expect(json.data.matched).toBe(0);
  });

  it('returns RATE_LIMITED (429) when all detections rate-limited', async () => {
    mockSearchGoogleBooks.mockResolvedValue({ ok: false, reason: 'rate_limited' });
    const { supabase } = makeSupabase({});
    const res = await POST(makeContext(supabase) as never);
    expect(res.status).toBe(429);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('RATE_LIMITED');
  });

  it('does NOT return RATE_LIMITED when only some detections are rate-limited', async () => {
    const { supabase } = makeSupabase({
      detectionsResult: {
        data: [
          detectionRow,
          { ...detectionRow, id: DET_ID_2, raw_title: 'Dune', position_index: 2 },
        ],
        error: null,
      },
    });

    mockSearchGoogleBooks
      .mockResolvedValueOnce({ ok: false, reason: 'rate_limited' })
      .mockResolvedValueOnce({ ok: true, candidates: [googleCandidate] });

    const res = await POST(makeContext(supabase) as never);
    expect(res.status).toBe(200);
  });

  it('inserts candidates with rank 1-N', async () => {
    const trackInsertions: { candidates: unknown[][] } = { candidates: [] };
    const { supabase } = makeSupabase({ trackInsertions });

    mockSearchGoogleBooks.mockResolvedValueOnce({
      ok: true,
      candidates: [
        googleCandidate,
        { ...googleCandidate, externalId: 'gb-2', title: 'Solaris (PL)', isbn13: null, isbn10: null },
      ],
    });

    await POST(makeContext(supabase) as never);

    const rows = trackInsertions.candidates[0] as { rank: number }[];
    expect(rows[0].rank).toBe(1);
    expect(rows[1].rank).toBe(2);
  });

  it('calls searchOpenLibrary for ISBN-enrichment when Google returns isbn', async () => {
    mockSearchOpenLibrary.mockResolvedValueOnce({ ok: false, reason: 'empty' });
    const { supabase } = makeSupabase({});
    await POST(makeContext(supabase) as never);
    expect(mockSearchOpenLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ isbn: googleCandidate.isbn13 })
    );
  });

  it('does NOT call searchOpenLibrary when Google returns no isbn', async () => {
    mockSearchGoogleBooks.mockResolvedValueOnce({
      ok: true,
      candidates: [{ ...googleCandidate, isbn13: null, isbn10: null }],
    });
    const { supabase } = makeSupabase({});
    await POST(makeContext(supabase) as never);
    expect(mockSearchOpenLibrary).not.toHaveBeenCalled();
  });

  it('quality threshold: candidates below MATCH_MID (0.55) are not persisted', async () => {
    // Realny przypadek: free-text fallback dla "Szalej i Srebro" / T. Kingfisher
    // zwraca śmieci (austriackie dzienniki ustaw) — titleSim ~0.15, autorzy puści
    // → score ~0.25. Poniżej progu → odrzucone, detekcja pokazuje "Wpisz ręcznie".
    const trackInsertions: { candidates: unknown[][] } = { candidates: [] };
    mockSearchGoogleBooks.mockResolvedValueOnce({
      ok: true,
      candidates: [
        {
          source: 'google_books' as const,
          externalId: 'gb-junk',
          title: 'Powszechny Dziennik praw panstwa i rzadu dla cesarstwa austryackiego',
          authors: [],
          isbn10: null,
          isbn13: null,
          publisher: null,
          publishedYear: 1849,
          coverUrl: null,
        },
      ],
    });
    const { supabase } = makeSupabase({
      detectionsResult: {
        data: [{ ...detectionRow, raw_title: 'Szalej i Srebro', raw_author: 'T. Kingfisher' }],
        error: null,
      },
      trackInsertions,
    });

    const res = await POST(makeContext(supabase) as never);
    const json = (await res.json()) as {
      data: { matched: number; detections: { status: string; candidates: unknown[] }[] };
    };
    // detekcja przetworzona, ale ZERO kandydatów zapisanych i zwróconych
    expect(json.data.matched).toBe(0);
    expect(json.data.detections[0].status).toBe('pending');
    expect(json.data.detections[0].candidates).toHaveLength(0);
    expect(trackInsertions.candidates).toHaveLength(0); // insert nie wołany
  });

  it('conservative rematch: keeps stronger existing candidates when new pass returns empty', async () => {
    const trackInsertions: { candidates: unknown[][] } = { candidates: [] };
    mockSearchGoogleBooks.mockResolvedValueOnce({ ok: true, candidates: [] });

    const { supabase } = makeSupabase({
      existingCandidatesResult: {
        data: [
          {
            detection_id: DET_ID_1,
            source: 'google_books',
            external_id: 'gb-existing-1',
            title: 'Solaris',
            authors: ['Stanisław Lem'],
            isbn_10: '0156027607',
            isbn_13: '9780156027601',
            publisher: 'Harvest Books',
            published_year: 1987,
            cover_url: 'https://books.google.com/cover.jpg',
            match_score: 0.92,
            rank: 1,
          },
        ],
        error: null,
      },
      trackInsertions,
    });

    const res = await POST(makeContext(supabase) as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { matched: number; detections: { status: string; candidates: { title: string }[] }[] };
    };

    expect(json.data.matched).toBe(1);
    expect(json.data.detections[0].status).toBe('matched');
    expect(json.data.detections[0].candidates[0].title).toBe('Solaris');
    expect(trackInsertions.candidates).toHaveLength(0);
  });
});
