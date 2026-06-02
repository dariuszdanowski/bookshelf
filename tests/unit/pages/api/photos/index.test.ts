import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../../../../../src/pages/api/photos/index';

// Valid RFC 4122 v4 UUIDs (version=4, variant=8) required by z.uuid() in Zod v4
const USER_ID = '00000000-0000-4000-8000-000000000001';
const SHELF_ID = '00000000-0000-4000-8000-000000000002';
const PHOTO_ID = '00000000-0000-4000-8000-000000000003';
const STORAGE_PATH = `${USER_ID}/photo.jpg`;
const VALID_HASH = 'a'.repeat(64);

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

const validRow: PhotoRow = {
  id: PHOTO_ID,
  shelf_id: SHELF_ID,
  status: 'uploaded',
  detected_count: null,
  error_message: null,
  vision_cost_usd: null,
  vision_latency_ms: null,
  created_at: '2026-05-27T10:00:00Z',
};

function makeContext(opts: {
  body: unknown;
  insertResult: { data: PhotoRow | null; error: { code?: string; message?: string; name?: string } | null };
  user?: { id: string } | null;
}) {
  const singleFn = vi.fn().mockResolvedValue(opts.insertResult);
  const selectFn = vi.fn(() => ({ single: singleFn }));
  const insertFn = vi.fn(() => ({ select: selectFn }));
  const fromFn = vi.fn(() => ({ insert: insertFn }));

  const request = new Request('http://localhost/api/photos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
  });

  return {
    context: {
      request,
      locals: {
        supabase: { from: fromFn } as never,
        user: opts.user === undefined ? ({ id: USER_ID } as never) : (opts.user as never),
      },
    },
    insertFn,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('POST /api/photos', () => {
  it('creates photo record and returns 201 + PhotoDTO', async () => {
    const { context, insertFn } = makeContext({
      body: { shelf_id: SHELF_ID, storage_path: STORAGE_PATH },
      insertResult: { data: validRow, error: null },
    });

    const res = await POST(context as never);
    expect(res.status).toBe(201);

    const json = (await res.json()) as { data: { photo: { id: string; status: string } } };
    expect(json.data.photo.id).toBe(PHOTO_ID);
    expect(json.data.photo.status).toBe('uploaded');
    expect(insertFn).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: USER_ID, shelf_id: SHELF_ID, storage_path: STORAGE_PATH, status: 'uploaded' })
    );
  });

  it('returns 401 UNAUTHENTICATED when user is null', async () => {
    const { context } = makeContext({
      body: { shelf_id: SHELF_ID, storage_path: STORAGE_PATH },
      insertResult: { data: null, error: null },
      user: null,
    });

    const res = await POST(context as never);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns 400 VALIDATION_ERROR for malformed JSON', async () => {
    const { context } = makeContext({
      body: 'not-json',
      insertResult: { data: null, error: null },
    });

    const res = await POST(context as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR for invalid Zod schema', async () => {
    const { context } = makeContext({
      body: { shelf_id: 'not-a-uuid', storage_path: '' },
      insertResult: { data: null, error: null },
    });

    const res = await POST(context as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string; details?: unknown } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.details).toBeDefined();
  });

  it('returns 400 VALIDATION_ERROR when storage_path does not start with user ID (F4)', async () => {
    const otherUserId = '00000000-0000-4000-8000-000000000099';
    const { context } = makeContext({
      body: { shelf_id: SHELF_ID, storage_path: `${otherUserId}/photo.jpg` },
      insertResult: { data: null, error: null },
    });

    const res = await POST(context as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 NOT_FOUND on Postgres 23503 (FK violation — shelf not found or RLS)', async () => {
    const { context } = makeContext({
      body: { shelf_id: SHELF_ID, storage_path: STORAGE_PATH },
      insertResult: { data: null, error: { code: '23503', message: 'FK violation', name: 'PostgrestError' } },
    });

    const res = await POST(context as never);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('returns 500 INTERNAL_ERROR on other supabase errors', async () => {
    const { context } = makeContext({
      body: { shelf_id: SHELF_ID, storage_path: STORAGE_PATH },
      insertResult: { data: null, error: { code: '99999', message: 'misc', name: 'PostgrestError' } },
    });

    const res = await POST(context as never);
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('INTERNAL_ERROR');
  });

  it('persists file_hash_sha256 when provided', async () => {
    const { context, insertFn } = makeContext({
      body: { shelf_id: SHELF_ID, storage_path: STORAGE_PATH, file_hash_sha256: VALID_HASH },
      insertResult: { data: validRow, error: null },
    });

    const res = await POST(context as never);
    expect(res.status).toBe(201);
    expect(insertFn).toHaveBeenCalledWith(
      expect.objectContaining({ file_hash_sha256: VALID_HASH })
    );
  });

  it('returns 409 DUPLICATE_PHOTO on Postgres 23505 (unique constraint — same hash)', async () => {
    const { context } = makeContext({
      body: { shelf_id: SHELF_ID, storage_path: STORAGE_PATH, file_hash_sha256: VALID_HASH },
      insertResult: { data: null, error: { code: '23505', message: 'unique violation', name: 'PostgrestError' } },
    });

    const res = await POST(context as never);
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('DUPLICATE_PHOTO');
  });
});
