import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '../../../../../src/pages/api/photos/[id]';

// Valid RFC 4122 v4 UUIDs (version=4, variant=8) — consistent with photos/index test
const USER_ID = '00000000-0000-4000-8000-000000000001';
const PHOTO_ID = '00000000-0000-4000-8000-000000000003';
const SHELF_ID = '00000000-0000-4000-8000-000000000002';

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
  position_index: number;
  raw_title: string | null;
  raw_author: string | null;
  vision_confidence: number | null;
  spine_color: string | null;
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
  { position_index: 1, raw_title: 'Solaris', raw_author: 'Stanisław Lem', vision_confidence: 0.95, spine_color: 'niebieski' },
  { position_index: 2, raw_title: 'Dune', raw_author: null, vision_confidence: 0.8, spine_color: 'brązowy' },
];

function makePhotoSelect(
  result: { data: PhotoRow | null; error: { code?: string; message?: string; name?: string } | null }
) {
  const singleFn = vi.fn().mockResolvedValue(result);
  const eqFn = vi.fn(() => ({ single: singleFn }));
  const selectFn = vi.fn(() => ({ eq: eqFn }));
  return { selectFn, singleFn };
}

function makeDetectionSelect(
  result: { data: DetectionRow[] | null; error: { code?: string; message?: string; name?: string } | null }
) {
  const orderFn = vi.fn().mockResolvedValue(result);
  const eqFn = vi.fn(() => ({ order: orderFn }));
  const selectFn = vi.fn(() => ({ eq: eqFn }));
  return { selectFn };
}

function makeContext(
  params: { id: string | undefined },
  photoResult: { data: PhotoRow | null; error: { code?: string; message?: string; name?: string } | null },
  detectionResult?: { data: DetectionRow[] | null; error: { code?: string; message?: string; name?: string } | null }
) {
  const photoSelect = makePhotoSelect(photoResult);
  const detSelect = detectionResult ? makeDetectionSelect(detectionResult) : null;

  let callCount = 0;
  const fromFn = vi.fn(() => {
    callCount++;
    if (callCount === 1) return { select: photoSelect.selectFn };
    if (callCount === 2 && detSelect) return { select: detSelect.selectFn };
    return { select: vi.fn() };
  });

  return {
    context: {
      params,
      locals: {
        supabase: { from: fromFn } as never,
        user: { id: USER_ID } as never,
      },
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/photos/[id]', () => {
  it('returns 404 for malformed UUID', async () => {
    const { context } = makeContext(
      { id: 'not-a-uuid' },
      { data: null, error: null }
    );

    const res = await GET(context as never);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for undefined id', async () => {
    const { context } = makeContext(
      { id: undefined },
      { data: null, error: null }
    );

    const res = await GET(context as never);
    expect(res.status).toBe(404);
  });

  it('returns 404 on PGRST116 (photo not found or RLS scoped out)', async () => {
    const { context } = makeContext(
      { id: PHOTO_ID },
      { data: null, error: { code: 'PGRST116', message: 'no rows', name: 'PostgrestError' } }
    );

    const res = await GET(context as never);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('returns 200 + photo DTO for uploaded (non-processed) photo — no detections', async () => {
    const { context } = makeContext(
      { id: PHOTO_ID },
      { data: uploadedRow, error: null }
    );

    const res = await GET(context as never);
    expect(res.status).toBe(200);

    const json = (await res.json()) as { data: { photo: { id: string; status: string }; detections?: unknown } };
    expect(json.data.photo.id).toBe(PHOTO_ID);
    expect(json.data.photo.status).toBe('uploaded');
    expect(json.data.detections).toBeUndefined();
  });

  it('returns 200 + photo + detections for processed photo', async () => {
    const { context } = makeContext(
      { id: PHOTO_ID },
      { data: processedRow, error: null },
      { data: detectionRows, error: null }
    );

    const res = await GET(context as never);
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      data: {
        photo: { id: string; status: string; detected_count: number | null };
        detections: { position_index: number; raw_title: string }[];
      };
    };
    expect(json.data.photo.status).toBe('processed');
    expect(json.data.photo.detected_count).toBe(2);
    expect(json.data.detections).toHaveLength(2);
    expect(json.data.detections[0].position_index).toBe(1);
    expect(json.data.detections[0].raw_title).toBe('Solaris');
    expect(json.data.detections[1].raw_title).toBe('Dune');
  });

  it('returns 500 INTERNAL_ERROR on unexpected supabase error', async () => {
    const { context } = makeContext(
      { id: PHOTO_ID },
      { data: null, error: { code: '99999', message: 'db error', name: 'PostgrestError' } }
    );

    const res = await GET(context as never);
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns 500 when detections fetch fails on processed photo', async () => {
    const { context } = makeContext(
      { id: PHOTO_ID },
      { data: processedRow, error: null },
      { data: null, error: { code: '99999', message: 'det error', name: 'PostgrestError' } }
    );

    const res = await GET(context as never);
    expect(res.status).toBe(500);
  });
});
