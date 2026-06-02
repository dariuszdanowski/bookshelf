import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '../../../../../src/pages/api/photos/check-hash';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const PHOTO_ID = '00000000-0000-4000-8000-000000000003';
const SHELF_ID = '00000000-0000-4000-8000-000000000002';
const VALID_HASH = 'a'.repeat(64);

type PhotoRow = { id: string; shelf_id: string; created_at: string } | null;

function makeContext(opts: {
  hash?: string;
  queryResult: { data: PhotoRow; error: { code?: string; message?: string; name?: string } | null };
  user?: { id: string } | null;
}) {
  const maybeSingleFn = vi.fn().mockResolvedValue(opts.queryResult);
  const limitFn = vi.fn(() => ({ maybeSingle: maybeSingleFn }));
  const eqHashFn = vi.fn(() => ({ limit: limitFn }));
  const eqUserFn = vi.fn(() => ({ eq: eqHashFn }));
  const selectFn = vi.fn(() => ({ eq: eqUserFn }));
  const fromFn = vi.fn(() => ({ select: selectFn }));

  const url = `http://localhost/api/photos/check-hash${opts.hash !== undefined ? `?hash=${opts.hash}` : ''}`;
  const request = new Request(url);

  return {
    context: {
      request,
      locals: {
        supabase: { from: fromFn } as never,
        user: opts.user === undefined ? ({ id: USER_ID } as never) : (opts.user as never),
      },
    },
    fromFn,
    eqUserFn,
    eqHashFn,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/photos/check-hash', () => {
  it('returns 401 UNAUTHENTICATED when user is null', async () => {
    const { context } = makeContext({
      hash: VALID_HASH,
      queryResult: { data: null, error: null },
      user: null,
    });

    const res = await GET(context as never);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns 400 VALIDATION_ERROR when hash param is missing', async () => {
    const { context } = makeContext({
      queryResult: { data: null, error: null },
    });

    const res = await GET(context as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when hash is wrong length', async () => {
    const { context } = makeContext({
      hash: 'abc123',
      queryResult: { data: null, error: null },
    });

    const res = await GET(context as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when hash contains non-hex chars', async () => {
    const { context } = makeContext({
      hash: 'z'.repeat(64),
      queryResult: { data: null, error: null },
    });

    const res = await GET(context as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 with photo when duplicate found', async () => {
    const photoRow = { id: PHOTO_ID, shelf_id: SHELF_ID, created_at: '2026-06-02T10:00:00Z' };
    const { context, eqHashFn } = makeContext({
      hash: VALID_HASH,
      queryResult: { data: photoRow, error: null },
    });

    const res = await GET(context as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { photo: typeof photoRow } };
    expect(json.data.photo.id).toBe(PHOTO_ID);
    expect(json.data.photo.shelf_id).toBe(SHELF_ID);
    expect(eqHashFn).toHaveBeenCalledWith('file_hash_sha256', VALID_HASH);
  });

  it('returns 200 with photo null when no duplicate', async () => {
    const { context } = makeContext({
      hash: VALID_HASH,
      queryResult: { data: null, error: null },
    });

    const res = await GET(context as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { photo: null } };
    expect(json.data.photo).toBeNull();
  });

  it('returns 500 INTERNAL_ERROR on supabase error', async () => {
    const { context } = makeContext({
      hash: VALID_HASH,
      queryResult: { data: null, error: { code: '99999', message: 'db error', name: 'PostgrestError' } },
    });

    const res = await GET(context as never);
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('INTERNAL_ERROR');
  });
});
