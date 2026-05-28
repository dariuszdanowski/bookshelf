import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '../../../../../src/pages/api/photos/[id]';

// Valid RFC 4122 v4 UUIDs (version=4, variant=8) — consistent with photos/index test
const USER_ID = '00000000-0000-4000-8000-000000000001';
const PHOTO_ID = '00000000-0000-4000-8000-000000000003';
const SHELF_ID = '00000000-0000-4000-8000-000000000002';
const DET_ID_1 = '00000000-0000-4000-8000-000000000010';
const DET_ID_2 = '00000000-0000-4000-8000-000000000011';
const CAND_ID_1 = '00000000-0000-4000-8000-000000000020';

type PhotoRow = {
  id: string;
  shelf_id: string;
  status: string;
  detected_count: number | null;
  error_message: string | null;
  vision_cost_usd: number | null;
  vision_latency_ms: number | null;
  created_at: string;
};

type DetectionRow = {
  id: string;
  position_index: number;
  raw_title: string | null;
  raw_author: string | null;
  vision_confidence: number | null;
  spine_color: string | null;
  bbox_x1: number | null;
  bbox_y1: number | null;
  bbox_x2: number | null;
  bbox_y2: number | null;
  status: string;
};

type CandidateRow = {
  id: string;
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
};

const uploadedRow: PhotoRow = {
  id: PHOTO_ID,
  shelf_id: SHELF_ID,
  status: 'uploaded',
  detected_count: null,
  error_message: null,
  vision_cost_usd: null,
  vision_latency_ms: null,
  created_at: '2026-05-27T10:00:00Z',
};

const processedRow: PhotoRow = {
  ...uploadedRow,
  status: 'processed',
  detected_count: 2,
  vision_cost_usd: 0.005,
  vision_latency_ms: 8200,
};

const detectionRows: DetectionRow[] = [
  {
    id: DET_ID_1,
    position_index: 1,
    raw_title: 'Solaris',
    raw_author: 'Stanisław Lem',
    vision_confidence: 0.95,
    spine_color: 'niebieski',
    bbox_x1: 0.1, bbox_y1: 0.1, bbox_x2: 0.2, bbox_y2: 0.9,
    status: 'matched',
  },
  {
    id: DET_ID_2,
    position_index: 2,
    raw_title: 'Dune',
    raw_author: null,
    vision_confidence: 0.8,
    spine_color: 'brązowy',
    bbox_x1: null, bbox_y1: null, bbox_x2: null, bbox_y2: null,
    status: 'pending',
  },
];

const candidateRow: CandidateRow = {
  id: CAND_ID_1,
  detection_id: DET_ID_1,
  source: 'google_books',
  external_id: 'gb-solaris',
  title: 'Solaris',
  authors: ['Stanisław Lem'],
  isbn_10: '0156027607',
  isbn_13: '9780156027601',
  publisher: 'Harvest Books',
  published_year: 1987,
  cover_url: 'https://books.google.com/cover.jpg',
  match_score: 0.92,
  rank: 1,
};

// ─── Builder helpers ────────────────────────────────────────────────────────

function makeSupabase(opts: {
  photoResult: { data: PhotoRow | null; error: { code?: string; message?: string; name?: string } | null };
  detectionResult?: { data: DetectionRow[] | null; error: { code?: string; message?: string; name?: string } | null };
  candidatesResult?: { data: CandidateRow[] | null; error: { code?: string; message?: string; name?: string } | null };
  booksResult?: {
    data: { id: string; title: string; authors: string[]; isbn_13: string | null; isbn_10: string | null }[] | null;
    error: { code?: string; message?: string; name?: string } | null;
  };
}) {
  const {
    photoResult,
    detectionResult,
    candidatesResult = { data: [], error: null },
    booksResult = { data: [], error: null },
  } = opts;

  return vi.fn((table: string) => {
    if (table === 'photos') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ single: vi.fn().mockResolvedValue(photoResult) })),
        })),
      };
    }

    if (table === 'detections') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn().mockResolvedValue(detectionResult ?? { data: [], error: null }),
          })),
        })),
      };
    }

    if (table === 'book_candidates') {
      return {
        select: vi.fn(() => ({
          in: vi.fn(() => ({
            order: vi.fn().mockResolvedValue(candidatesResult),
          })),
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

    return {};
  });
}

function makeContext(
  params: { id: string | undefined },
  fromFn: ReturnType<typeof makeSupabase>
) {
  return {
    params,
    locals: {
      supabase: { from: fromFn } as never,
      user: { id: USER_ID } as never,
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/photos/[id]', () => {
  it('returns 404 for malformed UUID', async () => {
    const from = makeSupabase({ photoResult: { data: null, error: null } });
    const res = await GET(makeContext({ id: 'not-a-uuid' }, from) as never);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for undefined id', async () => {
    const from = makeSupabase({ photoResult: { data: null, error: null } });
    const res = await GET(makeContext({ id: undefined }, from) as never);
    expect(res.status).toBe(404);
  });

  it('returns 404 on PGRST116 (photo not found or RLS scoped out)', async () => {
    const from = makeSupabase({
      photoResult: { data: null, error: { code: 'PGRST116', message: 'no rows', name: 'PostgrestError' } },
    });
    const res = await GET(makeContext({ id: PHOTO_ID }, from) as never);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('returns 200 + photo DTO for uploaded (non-processed) photo — no detections', async () => {
    const from = makeSupabase({ photoResult: { data: uploadedRow, error: null } });
    const res = await GET(makeContext({ id: PHOTO_ID }, from) as never);
    expect(res.status).toBe(200);

    const json = (await res.json()) as { data: { photo: { id: string; status: string }; detections?: unknown } };
    expect(json.data.photo.id).toBe(PHOTO_ID);
    expect(json.data.photo.status).toBe('uploaded');
    expect(json.data.detections).toBeUndefined();
  });

  it('returns 200 + photo + detections with candidates for processed photo', async () => {
    const from = makeSupabase({
      photoResult: { data: processedRow, error: null },
      detectionResult: { data: detectionRows, error: null },
      candidatesResult: { data: [candidateRow], error: null },
      booksResult: { data: [], error: null },
    });

    const res = await GET(makeContext({ id: PHOTO_ID }, from) as never);
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      data: {
        photo: { status: string; detected_count: number | null };
        detections: {
          id: string;
          position_index: number;
          raw_title: string;
          status: string;
          candidates: { id: string; title: string; matchScore: number }[];
          duplicate: null | { type: string };
        }[];
      };
    };

    expect(json.data.photo.status).toBe('processed');
    expect(json.data.photo.detected_count).toBe(2);
    expect(json.data.detections).toHaveLength(2);

    const det1 = json.data.detections[0];
    expect(det1.id).toBe(DET_ID_1);
    expect(det1.raw_title).toBe('Solaris');
    expect(det1.status).toBe('matched');
    expect(det1.candidates).toHaveLength(1);
    expect(det1.candidates[0].title).toBe('Solaris');
    expect(det1.candidates[0].matchScore).toBe(0.92);
    expect(det1.duplicate).toBeNull();

    const det2 = json.data.detections[1];
    expect(det2.id).toBe(DET_ID_2);
    expect(det2.candidates).toHaveLength(0);
    expect(det2.duplicate).toBeNull();
  });

  it('sets duplicate=exact when top candidate isbn_13 matches catalog', async () => {
    const existingBook = {
      id: '00000000-0000-4000-8000-000000000099',
      title: 'Solaris',
      authors: ['Stanisław Lem'],
      isbn_13: '9780156027601',
      isbn_10: null,
    };

    const from = makeSupabase({
      photoResult: { data: processedRow, error: null },
      detectionResult: { data: [detectionRows[0]], error: null },
      candidatesResult: { data: [candidateRow], error: null },
      booksResult: { data: [existingBook], error: null },
    });

    const res = await GET(makeContext({ id: PHOTO_ID }, from) as never);
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      data: { detections: { duplicate: { type: string } | null }[] };
    };
    expect(json.data.detections[0].duplicate).toEqual({ type: 'exact' });
  });

  it('returns bbox when all bbox fields are present', async () => {
    const from = makeSupabase({
      photoResult: { data: processedRow, error: null },
      detectionResult: { data: [detectionRows[0]], error: null },
      candidatesResult: { data: [], error: null },
      booksResult: { data: [], error: null },
    });

    const res = await GET(makeContext({ id: PHOTO_ID }, from) as never);
    const json = (await res.json()) as {
      data: { detections: { bbox: { x1: number } | null }[] };
    };
    expect(json.data.detections[0].bbox).toEqual({ x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.9 });
  });

  it('returns null bbox when bbox fields are null', async () => {
    const from = makeSupabase({
      photoResult: { data: processedRow, error: null },
      detectionResult: { data: [detectionRows[1]], error: null },
      candidatesResult: { data: [], error: null },
      booksResult: { data: [], error: null },
    });

    const res = await GET(makeContext({ id: PHOTO_ID }, from) as never);
    const json = (await res.json()) as {
      data: { detections: { bbox: null }[] };
    };
    expect(json.data.detections[0].bbox).toBeNull();
  });

  it('returns 500 INTERNAL_ERROR on unexpected supabase error', async () => {
    const from = makeSupabase({
      photoResult: { data: null, error: { code: '99999', message: 'db error', name: 'PostgrestError' } },
    });
    const res = await GET(makeContext({ id: PHOTO_ID }, from) as never);
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns 500 when detections fetch fails on processed photo', async () => {
    const from = makeSupabase({
      photoResult: { data: processedRow, error: null },
      detectionResult: { data: null, error: { code: '99999', message: 'det error', name: 'PostgrestError' } },
    });
    const res = await GET(makeContext({ id: PHOTO_ID }, from) as never);
    expect(res.status).toBe(500);
  });

  it('returns 500 when book_candidates fetch fails', async () => {
    const from = makeSupabase({
      photoResult: { data: processedRow, error: null },
      detectionResult: { data: detectionRows, error: null },
      candidatesResult: { data: null, error: { code: '99999', message: 'cand error', name: 'PostgrestError' } },
      booksResult: { data: [], error: null },
    });
    const res = await GET(makeContext({ id: PHOTO_ID }, from) as never);
    expect(res.status).toBe(500);
  });
});
