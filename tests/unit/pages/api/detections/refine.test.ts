import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDeriveDetectionCrop = vi.hoisted(() => vi.fn());
const mockDetectSingleSpineFromCrop = vi.hoisted(() => vi.fn());
const mockSearchGoogleBooks = vi.hoisted(() => vi.fn());
const mockSearchOpenLibrary = vi.hoisted(() => vi.fn());

vi.mock('../../../../../src/lib/images/crop', () => ({
  deriveDetectionCrop: mockDeriveDetectionCrop,
}));

vi.mock('../../../../../src/lib/vision/client', () => ({
  detectSingleSpineFromCrop: mockDetectSingleSpineFromCrop,
}));

vi.mock('../../../../../src/lib/books/googleBooks', () => ({
  searchGoogleBooks: mockSearchGoogleBooks,
}));

vi.mock('../../../../../src/lib/books/openLibrary', () => ({
  searchOpenLibrary: mockSearchOpenLibrary,
}));

import { POST } from '../../../../../src/pages/api/detections/[id]/refine';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const DETECTION_ID = '00000000-0000-4000-8000-000000000010';
const PHOTO_ID = '00000000-0000-4000-8000-000000000020';

type DetectionRow = {
  id: string;
  photo_id: string;
  raw_title: string | null;
  raw_author: string | null;
  vision_confidence: number | null;
  spine_color: string | null;
  status: string;
  bbox_x1: number | null;
  bbox_y1: number | null;
  bbox_x2: number | null;
  bbox_y2: number | null;
};

const detectionRow: DetectionRow = {
  id: DETECTION_ID,
  photo_id: PHOTO_ID,
  raw_title: 'Solaris',
  raw_author: 'Stanisław Lem',
  vision_confidence: 0.5,
  spine_color: 'szary',
  status: 'pending',
  bbox_x1: 0.2,
  bbox_y1: 0.1,
  bbox_x2: 0.32,
  bbox_y2: 0.96,
};

const photoRow = {
  id: PHOTO_ID,
  storage_path: `${USER_ID}/photo.jpg`,
};

const goodCandidate = {
  source: 'google_books' as const,
  externalId: 'gb-1',
  title: 'Solaris',
  authors: ['Stanisław Lem'],
  isbn10: '0156027607',
  isbn13: '9780156027601',
  publisher: 'Harvest Books',
  publishedYear: 1987,
  coverUrl: null,
};

function makeSupabase(opts?: {
  detectionResult?: { data: DetectionRow | null; error: { code?: string; name: string; message: string } | null };
  photoResult?: { data: typeof photoRow | null; error: { code?: string; name: string; message: string } | null };
  existingCandidatesResult?: { data: { match_score: number; source: string; external_id: string; title: string; authors: string[]; isbn_10: string | null; isbn_13: string | null; publisher: string | null; published_year: number | null; cover_url: string | null; rank: number }[] | null; error: { code?: string; name: string; message: string } | null };
  booksResult?: { data: { id: string; title: string; authors: string[]; isbn_13: string | null; isbn_10: string | null }[] | null; error: { code?: string; name: string; message: string } | null };
  track?: { detectionUpdatePayload: unknown[]; candidateInsertPayload: unknown[]; candidateDeleteCalls: number };
}) {
  const detectionResult = opts?.detectionResult ?? { data: detectionRow, error: null };
  const photoResult = opts?.photoResult ?? { data: photoRow, error: null };
  const existingCandidatesResult = opts?.existingCandidatesResult ?? { data: [], error: null };
  const booksResult = opts?.booksResult ?? { data: [], error: null };

  const from = vi.fn((table: string) => {
    if (table === 'detections') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue(detectionResult) })),
        })),
        update: vi.fn((payload: unknown) => {
          if (opts?.track) opts.track.detectionUpdatePayload.push(payload);
          return { eq: vi.fn().mockResolvedValue({ error: null }) };
        }),
      };
    }

    if (table === 'photos') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue(photoResult) })),
        })),
      };
    }

    if (table === 'book_candidates') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue(existingCandidatesResult),
        })),
        delete: vi.fn(() => ({
          eq: vi.fn(() => {
            if (opts?.track) opts.track.candidateDeleteCalls += 1;
            return Promise.resolve({ error: null });
          }),
        })),
        insert: vi.fn((rows: unknown) => {
          if (opts?.track) opts.track.candidateInsertPayload.push(rows);
          return Promise.resolve({ error: null });
        }),
      };
    }

    if (table === 'books') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue(booksResult),
        })),
      };
    }

    if (table === 'corrections') {
      return {
        insert: vi.fn().mockResolvedValue({ error: null }),
      };
    }

    return {};
  });

  const supabase = {
    from,
    storage: {
      from: vi.fn(() => ({
        download: vi.fn().mockResolvedValue({ data: new Blob(['img'], { type: 'image/jpeg' }), error: null }),
      })),
    },
  } as never;

  return supabase;
}

function makeContext(supabase: ReturnType<typeof makeSupabase>, user = true, id = DETECTION_ID) {
  return {
    params: { id },
    locals: {
      user: user ? ({ id: USER_ID } as never) : null,
      supabase,
    },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();

  mockDeriveDetectionCrop.mockResolvedValue({
    bytes: new Uint8Array([1, 2, 3]),
    mediaType: 'image/jpeg',
  });

  mockDetectSingleSpineFromCrop.mockResolvedValue({
    ok: true,
    detection: {
      position: 1,
      title: 'Solaris',
      author: 'Stanisław Lem',
      confidence: 0.88,
      spine_color: 'niebieski',
      bbox: null,
    },
    model: 'claude-sonnet-4-6',
    costUsd: 0.001,
    latencyMs: 800,
  });

  mockSearchGoogleBooks.mockResolvedValue({ ok: true, candidates: [goodCandidate] });
  mockSearchOpenLibrary.mockResolvedValue({ ok: false, reason: 'empty' });
});

describe('POST /api/detections/[id]/refine', () => {
  it('returns 401 when not authenticated', async () => {
    const supabase = makeSupabase();
    const res = await POST(makeContext(supabase, false));
    expect(res.status).toBe(401);
  });

  it('returns 404 for malformed detection id', async () => {
    const supabase = makeSupabase();
    const res = await POST(makeContext(supabase, true, 'bad-uuid'));
    expect(res.status).toBe(404);
  });

  it('returns 200 applied=false when detection has missing bbox', async () => {
    const supabase = makeSupabase({
      detectionResult: {
        data: { ...detectionRow, bbox_x1: null, bbox_y1: null, bbox_x2: null, bbox_y2: null },
        error: null,
      },
    });

    const res = await POST(makeContext(supabase));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { applied: boolean; reason: string } };
    expect(json.data.applied).toBe(false);
    expect(json.data.reason).toBe('bbox_not_precise');
  });

  it('attempts refine for non-clean bbox instead of early bbox_not_precise response', async () => {
    const supabase = makeSupabase({
      detectionResult: {
        data: { ...detectionRow, bbox_x1: 0.05, bbox_y1: 0.1, bbox_x2: 0.9, bbox_y2: 0.95 },
        error: null,
      },
    });

    const res = await POST(makeContext(supabase));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { applied: boolean; reason?: string } };
    expect(json.data.applied).toBe(true);
    expect(json.data.reason).toBeUndefined();
    expect(mockDeriveDetectionCrop).toHaveBeenCalledTimes(1);
    expect(mockDetectSingleSpineFromCrop).toHaveBeenCalledTimes(1);
  });

  it('returns 200 applied=false when refine vision cannot parse', async () => {
    mockDetectSingleSpineFromCrop.mockResolvedValueOnce({
      ok: false,
      reason: 'parse_failure',
      latencyMs: 500,
    });

    const supabase = makeSupabase();
    const res = await POST(makeContext(supabase));

    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { applied: boolean; reason: string } };
    expect(json.data.applied).toBe(false);
    expect(json.data.reason).toBe('parse_failure');
  });

  it('returns 200 and updates detection + candidates on successful refine', async () => {
    const track = {
      detectionUpdatePayload: [] as unknown[],
      candidateInsertPayload: [] as unknown[],
      candidateDeleteCalls: 0,
    };
    const supabase = makeSupabase({ track });

    const res = await POST(makeContext(supabase));
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      data: {
        detection: { status: string; raw_title: string };
        candidates: Array<{ title: string }>;
      };
    };

    expect(json.data.detection.status).toBe('matched');
    expect(json.data.detection.raw_title).toBe('Solaris');
    expect(json.data.candidates).toHaveLength(1);
    expect(json.data.candidates[0].title).toBe('Solaris');

    expect(track.detectionUpdatePayload).toHaveLength(1);
    expect(track.candidateDeleteCalls).toBe(1);
    expect(track.candidateInsertPayload).toHaveLength(1);
  });

  it('returns 429 when Google Books is rate limited for refined query', async () => {
    mockSearchGoogleBooks.mockResolvedValueOnce({ ok: false, reason: 'rate_limited' });
    const supabase = makeSupabase();

    const res = await POST(makeContext(supabase));
    expect(res.status).toBe(429);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('RATE_LIMITED');
  });
});
