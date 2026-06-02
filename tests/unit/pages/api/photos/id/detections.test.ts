import { describe, expect, it, vi } from 'vitest';

import { POST } from '../../../../../../src/pages/api/photos/[id]/detections';

const PHOTO_ID = '00000000-0000-4000-8000-000000000030';
const VISION_RUN_ID = '00000000-0000-4000-8000-000000000050';
const NEW_DET_ID = '00000000-0000-4000-8000-000000000099';

type ApiJson = { data?: Record<string, unknown>; error?: { code: string; message: string } };

const VALID_BBOX = { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.9 };

const insertedRow = {
  id: NEW_DET_ID,
  position_index: 4,
  raw_title: '',
  raw_author: null,
  vision_confidence: null,
  spine_color: null,
  status: 'pending',
  bbox_x1: 0.1,
  bbox_y1: 0.1,
  bbox_x2: 0.5,
  bbox_y2: 0.9,
};

function makeContext(opts: {
  id?: string;
  body?: unknown;
  user?: boolean;
  photoExists?: boolean;
  visionRuns?: { id: string }[];
  maxPosition?: number | null;
  insertResult?: { data: typeof insertedRow | null; error: { name: string; message: string; code?: string } | null };
}) {
  const {
    photoExists = true,
    visionRuns = [{ id: VISION_RUN_ID }],
    maxPosition = 3,
    insertResult = { data: insertedRow, error: null },
  } = opts;

  const fromFn = vi.fn((table: string) => {
    if (table === 'photos') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: photoExists ? { id: PHOTO_ID } : null,
              error: null,
            }),
          })),
        })),
      };
    }
    if (table === 'vision_runs') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue({ data: visionRuns, error: null }),
            })),
          })),
        })),
      };
    }
    if (table === 'detections') {
      const singleFn = vi.fn().mockResolvedValue(insertResult);
      const selectAfterInsert = vi.fn(() => ({ single: singleFn }));
      const insertFn = vi.fn(() => ({ select: selectAfterInsert }));

      // For MAX position_index query
      const limitFn = vi.fn().mockResolvedValue({
        data: maxPosition != null ? [{ position_index: maxPosition }] : [],
        error: null,
      });
      const orderFn = vi.fn(() => ({ limit: limitFn }));
      const eqForSelect = vi.fn(() => ({ order: orderFn }));
      const selectForMax = vi.fn(() => ({ eq: eqForSelect }));

      return {
        select: selectForMax,
        insert: insertFn,
      };
    }
    return {};
  });

  return {
    params: { id: opts.id ?? PHOTO_ID },
    request: {
      json: vi.fn().mockResolvedValue(opts.body ?? { bbox: VALID_BBOX }),
    },
    locals: {
      user: opts.user !== false ? { id: 'user-1', email: 'test@test.com' } : null,
      supabase: { from: fromFn } as never,
    },
  } as never;
}

describe('POST /api/photos/[id]/detections', () => {
  it('401 gdy brak użytkownika', async () => {
    const ctx = makeContext({ user: false });
    const res = await POST(ctx);
    expect(res.status).toBe(401);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('UNAUTHENTICATED');
  });

  it('404 gdy id nie jest UUID', async () => {
    const ctx = makeContext({ id: 'bad-uuid' });
    const res = await POST(ctx);
    expect(res.status).toBe(404);
  });

  it('404 gdy foto nie istnieje', async () => {
    const ctx = makeContext({ photoExists: false });
    const res = await POST(ctx);
    expect(res.status).toBe(404);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('NOT_FOUND');
  });

  it('400 gdy brak vision_runs', async () => {
    const ctx = makeContext({ visionRuns: [] });
    const res = await POST(ctx);
    expect(res.status).toBe(400);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('VALIDATION_ERROR');
    expect(json.error!.message).toContain('vision');
  });

  it('400 gdy x1 >= x2', async () => {
    const ctx = makeContext({ body: { bbox: { x1: 0.5, y1: 0.1, x2: 0.3, y2: 0.9 } } });
    const res = await POST(ctx);
    expect(res.status).toBe(400);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('VALIDATION_ERROR');
  });

  it('200 zwraca DetectionWithCandidatesDTO z candidates=[] i duplicate=null', async () => {
    const ctx = makeContext({});
    const res = await POST(ctx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!.id).toBe(NEW_DET_ID);
    expect(json.data!.status).toBe('pending');
    expect(json.data!.candidates).toEqual([]);
    expect(json.data!.duplicate).toBeNull();
    expect(json.data!.bbox).toEqual(VALID_BBOX);
    expect(json.data!.raw_title).toBe('');
  });

  it('Cache-Control: private, no-store', async () => {
    const ctx = makeContext({});
    const res = await POST(ctx);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
