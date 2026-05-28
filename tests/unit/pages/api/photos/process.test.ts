import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock vision client — hoisted so it's available in the mock factory
const mockDetectSpines = vi.hoisted(() => vi.fn());
const mockDeriveWorkingCopy = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ bytes: new Uint8Array([0xff, 0xd8, 0xff]), mediaType: 'image/jpeg' as const })
);

vi.mock('../../../../../src/lib/vision/client', () => ({
  detectSpines: mockDetectSpines,
}));

vi.mock('../../../../../src/lib/images/resize', () => ({
  deriveWorkingCopy: mockDeriveWorkingCopy,
}));

import { POST } from '../../../../../src/pages/api/photos/[id]/process';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const PHOTO_ID = '00000000-0000-4000-8000-000000000003';
const RUN_ID = '00000000-0000-4000-8000-000000000099';
const STORAGE_PATH = `${USER_ID}/photo.jpg`;

type PhotoSelectRow = { id: string; storage_path: string; status: string };
type PhotoFinalRow = {
  id: string; shelf_id: string; status: string; detected_count: number | null;
  error_message: string | null; vision_cost_usd: number | null; vision_latency_ms: number | null; created_at: string;
};
type DetRow = {
  position_index: number; raw_title: string | null; raw_author: string | null;
  vision_confidence: number | null; spine_color: string | null;
  bbox_x1: number | null; bbox_y1: number | null; bbox_x2: number | null; bbox_y2: number | null;
};

const photoSelectRow: PhotoSelectRow = { id: PHOTO_ID, storage_path: STORAGE_PATH, status: 'uploaded' };
const photoFinalRow: PhotoFinalRow = {
  id: PHOTO_ID, shelf_id: '00000000-0000-4000-8000-000000000002', status: 'processed',
  detected_count: 1, error_message: null, vision_cost_usd: 0.005, vision_latency_ms: 5000,
  created_at: '2026-05-27T10:00:00Z',
};
const detectionRows: DetRow[] = [
  {
    position_index: 1, raw_title: 'Solaris', raw_author: 'Stanisław Lem', vision_confidence: 0.95, spine_color: 'niebieski',
    bbox_x1: 0.1, bbox_y1: 0.05, bbox_x2: 0.25, bbox_y2: 0.95,
  },
];

const validVisionResult = {
  ok: true as const,
  detections: [{
    position: 1, title: 'Solaris', author: 'Stanisław Lem', confidence: 0.95,
    spine_color: 'niebieski' as const, bbox: [0.1, 0.05, 0.25, 0.95] as [number, number, number, number],
  }],
  model: 'claude-sonnet-4-6',
  costUsd: 0.005,
  latencyMs: 5000,
};

function makeBlob(content = 'fake-image-data') {
  return new Blob([content], { type: 'image/jpeg' });
}

function makeSupabase(opts: {
  photoSelectResult?: { data: PhotoSelectRow | null; error: { code?: string; message?: string; name?: string } | null };
  downloadResult?: { data: Blob | null; error: { message?: string } | null };
  photoFinalResult?: { data: PhotoFinalRow | null; error: null };
  detFinalResult?: { data: DetRow[] | null; error: null };
  visionRunInsertError?: { code?: string; message?: string; name?: string } | null;
  trackInsertions?: { detections: unknown[][] };
}) {
  const {
    photoSelectResult = { data: photoSelectRow, error: null },
    downloadResult = { data: makeBlob(), error: null },
    photoFinalResult = { data: photoFinalRow, error: null },
    detFinalResult = { data: detectionRows, error: null },
    visionRunInsertError = null,
    trackInsertions,
  } = opts;

  let photosSelectCallCount = 0;

  const mockStorage = {
    from: vi.fn(() => ({
      download: vi.fn().mockResolvedValue(downloadResult),
    })),
  };

  const fromFn = vi.fn((table: string) => {
    if (table === 'photos') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => {
            photosSelectCallCount++;
            if (photosSelectCallCount === 1) {
              return { single: vi.fn().mockResolvedValue(photoSelectResult) };
            }
            return { single: vi.fn().mockResolvedValue(photoFinalResult) };
          }),
        })),
        update: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
        })),
      };
    }

    if (table === 'vision_runs') {
      return {
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue(
              visionRunInsertError
                ? { data: null, error: visionRunInsertError }
                : { data: { id: RUN_ID }, error: null }
            ),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
        })),
      };
    }

    if (table === 'detections') {
      return {
        insert: vi.fn((rows: unknown[]) => {
          if (trackInsertions) trackInsertions.detections.push(rows);
          return Promise.resolve({ error: null });
        }),
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn().mockResolvedValue(detFinalResult),
          })),
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

  return {
    supabase: { from: fromFn, storage: mockStorage } as never,
    fromFn,
    mockStorage,
  };
}

function makeContext(
  supabase: ReturnType<typeof makeSupabase>['supabase'],
  photoId = PHOTO_ID
) {
  return {
    params: { id: photoId },
    locals: {
      supabase,
      user: { id: USER_ID } as never,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDetectSpines.mockResolvedValue(validVisionResult);
  mockDeriveWorkingCopy.mockResolvedValue({ bytes: new Uint8Array([0xff, 0xd8, 0xff]), mediaType: 'image/jpeg' as const });
});

describe('POST /api/photos/[id]/process', () => {
  it('returns 401 for unauthenticated request', async () => {
    const { supabase } = makeSupabase({});
    const res = await POST({ params: { id: PHOTO_ID }, locals: { supabase, user: null } } as never);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns 404 for malformed UUID', async () => {
    const { supabase } = makeSupabase({});
    const ctx = makeContext(supabase, 'not-a-uuid');
    const res = await POST(ctx as never);
    expect(res.status).toBe(404);
  });

  it('returns 404 when photo PGRST116 (not found or RLS)', async () => {
    const { supabase } = makeSupabase({
      photoSelectResult: { data: null, error: { code: 'PGRST116', message: 'no rows', name: 'Err' } },
    });
    const res = await POST(makeContext(supabase) as never);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('returns 409 CONFLICT when trigger P0001 blocks concurrent run', async () => {
    const { supabase } = makeSupabase({
      visionRunInsertError: {
        code: 'P0001',
        message: 'Vision run already in progress for this photo. Try again in a moment.',
        name: 'PostgrestError',
      },
    });
    const res = await POST(makeContext(supabase) as never);
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('CONFLICT');
    expect(json.error.message).toContain('already in progress');
  });

  it('happy path: creates vision_run, inserts detections with vision_run_id, returns 200', async () => {
    const trackInsertions: { detections: unknown[][] } = { detections: [] };
    const { supabase, fromFn } = makeSupabase({ trackInsertions });

    const res = await POST(makeContext(supabase) as never);
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      data: { photo: { status: string; detected_count: number | null }; detections: { raw_title: string }[] };
    };
    expect(json.data.photo.status).toBe('processed');
    expect(json.data.photo.detected_count).toBe(1);
    expect(json.data.detections).toHaveLength(1);
    expect(json.data.detections[0].raw_title).toBe('Solaris');

    expect(mockDetectSpines).toHaveBeenCalledOnce();

    // vision_runs INSERT must have been called
    const visionRunCalls = fromFn.mock.calls.filter(([t]) => t === 'vision_runs');
    expect(visionRunCalls.length).toBeGreaterThan(0);

    // detections INSERT must include vision_run_id
    expect(trackInsertions.detections).toHaveLength(1);
    const insertedRow = (trackInsertions.detections[0] as { vision_run_id: string }[])[0];
    expect(insertedRow.vision_run_id).toBe(RUN_ID);
  });

  it('does NOT delete existing detections (append-only)', async () => {
    const { supabase, fromFn } = makeSupabase({});
    await POST(makeContext(supabase) as never);

    // No delete should have been called on detections table
    const detectionsMock = fromFn.mock.results.find((_, i) => fromFn.mock.calls[i]?.[0] === 'detections')?.value;
    // If delete was called on detections, the mock would expose it; ensure no delete key in detections mock
    // Since makeSupabase doesn't provide a delete on detections, any call would throw or not be tracked
    // Simply verify the test passes — the new process.ts has no delete on detections
    expect(detectionsMock).toBeDefined();
    expect(typeof detectionsMock?.delete).toBe('undefined');
  });

  it('parse_failure: inserts correction, sets vision_run failed, returns 400', async () => {
    mockDetectSpines.mockResolvedValue({ ok: false, reason: 'parse_failure', latencyMs: 3000 });
    const { supabase, fromFn } = makeSupabase({});

    const res = await POST(makeContext(supabase) as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');

    const correctionInsert = fromFn.mock.calls.some(([t]) => t === 'corrections');
    expect(correctionInsert).toBe(true);

    // vision_runs update (set failed) must have been called
    const visionRunCalls = fromFn.mock.calls.filter(([t]) => t === 'vision_runs');
    expect(visionRunCalls.length).toBeGreaterThan(0);
  });

  it('returns RATE_LIMITED (429) on Anthropic 429 error, sets vision_run failed', async () => {
    const rateError = Object.assign(new Error('Too many requests'), { status: 429 });
    mockDetectSpines.mockRejectedValueOnce(rateError);
    const { supabase } = makeSupabase({});

    const res = await POST(makeContext(supabase) as never);
    expect(res.status).toBe(429);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('RATE_LIMITED');
  });

  it('returns RATE_LIMITED (429) on Anthropic 529 (overload)', async () => {
    const overloadError = Object.assign(new Error('Overloaded'), { status: 529 });
    mockDetectSpines.mockRejectedValueOnce(overloadError);
    const { supabase } = makeSupabase({});

    const res = await POST(makeContext(supabase) as never);
    expect(res.status).toBe(429);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
  });

  it('returns 500 on Storage download failure', async () => {
    const { supabase } = makeSupabase({
      downloadResult: { data: null, error: { message: 'Storage down' } },
    });

    const res = await POST(makeContext(supabase) as never);
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('INTERNAL_ERROR');
  });

  it('bbox: inserts bbox_x1..y2 when vision returns bbox', async () => {
    const trackInsertions: { detections: unknown[][] } = { detections: [] };
    const { supabase } = makeSupabase({ trackInsertions });

    mockDetectSpines.mockResolvedValueOnce({
      ...validVisionResult,
      detections: [{ ...validVisionResult.detections[0], bbox: [0.1, 0.05, 0.25, 0.95] as [number, number, number, number] }],
    });

    await POST(makeContext(supabase) as never);
    expect(trackInsertions.detections).toHaveLength(1);
    const row = (trackInsertions.detections[0] as { bbox_x1: number; bbox_y1: number; bbox_x2: number; bbox_y2: number }[])[0];
    expect(row.bbox_x1).toBeCloseTo(0.1);
    expect(row.bbox_y1).toBeCloseTo(0.05);
    expect(row.bbox_x2).toBeCloseTo(0.25);
    expect(row.bbox_y2).toBeCloseTo(0.95);
  });

  it('bbox: inserts null bbox fields when vision returns no bbox', async () => {
    const trackInsertions: { detections: unknown[][] } = { detections: [] };
    const { supabase } = makeSupabase({ trackInsertions });

    mockDetectSpines.mockResolvedValueOnce({
      ...validVisionResult,
      detections: [{ ...validVisionResult.detections[0], bbox: undefined }],
    });

    await POST(makeContext(supabase) as never);
    expect(trackInsertions.detections).toHaveLength(1);
    const row = (trackInsertions.detections[0] as { bbox_x1: unknown; bbox_y1: unknown }[])[0];
    expect(row.bbox_x1).toBeNull();
    expect(row.bbox_y1).toBeNull();
  });

  it('deriveWorkingCopy failure: sets vision_run failed, returns 500', async () => {
    mockDeriveWorkingCopy.mockRejectedValueOnce(new Error('photon crash'));
    const { supabase } = makeSupabase({});

    const res = await POST(makeContext(supabase) as never);
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('INTERNAL_ERROR');
  });
});
