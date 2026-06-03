import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DELETE, PATCH } from '../../../../../src/pages/api/photos/[id]';

const VALID_ID = '12345678-1234-1234-1234-123456789012';
const VALID_SHELF = '11111111-1111-4111-8111-111111111111';

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

type PgError = { code?: string; message?: string; name?: string } | null;

const validRow: PhotoRow = {
  id: VALID_ID,
  shelf_id: VALID_SHELF,
  status: 'processed',
  detected_count: 3,
  error_message: null,
  vision_cost_usd: 0.0123,
  vision_latency_ms: 4200,
  created_at: '2026-06-03T12:00:00Z',
};

function makePatchContext(opts: {
  id?: string;
  body: unknown;
  updateResult: { data: PhotoRow | null; error: PgError };
  user?: { id: string; email: string } | null;
}) {
  const singleFn = vi.fn().mockResolvedValue(opts.updateResult);
  const selectFn = vi.fn(() => ({ single: singleFn }));
  const eqFn = vi.fn(() => ({ select: selectFn }));
  const updateFn = vi.fn(() => ({ eq: eqFn }));
  const fromFn = vi.fn(() => ({ update: updateFn }));
  const request = new Request(`http://localhost/api/photos/${opts.id ?? VALID_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
  });
  return {
    context: {
      request,
      params: { id: opts.id ?? VALID_ID },
      locals: {
        supabase: { from: fromFn } as never,
        user: opts.user === undefined ? ({ id: 'user-1', email: 't@test' } as never) : (opts.user as never),
      },
    },
    updateFn,
  };
}

function makeDeleteContext(opts: {
  id?: string;
  existing?: { id: string; storage_path: string } | null;
  existingError?: PgError;
  deleteError?: PgError;
  removeResult?: { error: PgError };
  removeThrows?: boolean;
  user?: { id: string; email: string } | null;
}) {
  const maybeSingleFn = vi.fn().mockResolvedValue({
    data: opts.existing === undefined ? { id: 'x', storage_path: 'user-1/abc.jpg' } : opts.existing,
    error: opts.existingError ?? null,
  });
  const selectEqFn = vi.fn(() => ({ maybeSingle: maybeSingleFn }));
  const selectFn = vi.fn(() => ({ eq: selectEqFn }));

  const deleteEqFn = vi.fn().mockResolvedValue({ error: opts.deleteError ?? null });
  const deleteFn = vi.fn(() => ({ eq: deleteEqFn }));

  // from('photos'): first call → select chain; second → delete chain.
  let callCount = 0;
  const fromFn = vi.fn(() => {
    callCount += 1;
    return callCount === 1 ? { select: selectFn } : { delete: deleteFn };
  });

  const removeFn = opts.removeThrows
    ? vi.fn().mockRejectedValue(new Error('network'))
    : vi.fn().mockResolvedValue(opts.removeResult ?? { error: null });
  const storageFromFn = vi.fn(() => ({ remove: removeFn }));

  return {
    context: {
      params: { id: opts.id ?? VALID_ID },
      locals: {
        supabase: { from: fromFn, storage: { from: storageFromFn } } as never,
        user: opts.user === undefined ? ({ id: 'user-1', email: 't@test' } as never) : (opts.user as never),
      },
    },
    deleteFn,
    removeFn,
    storageFromFn,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('PATCH /api/photos/:id', () => {
  it('updates shelf_id and returns 200 with photo', async () => {
    const { context, updateFn } = makePatchContext({
      body: { shelf_id: VALID_SHELF },
      updateResult: { data: validRow, error: null },
    });
    const res = await PATCH(context as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { photo: { shelf_id: string } } };
    expect(json.data.photo.shelf_id).toBe(VALID_SHELF);
    expect(updateFn).toHaveBeenCalledWith(expect.objectContaining({ shelf_id: VALID_SHELF }));
  });

  it('returns 401 when unauthenticated', async () => {
    const { context } = makePatchContext({
      body: { shelf_id: VALID_SHELF },
      updateResult: { data: null, error: null },
      user: null,
    });
    const res = await PATCH(context as never);
    expect(res.status).toBe(401);
  });

  it('returns 404 for malformed UUID', async () => {
    const { context } = makePatchContext({
      id: 'not-a-uuid',
      body: { shelf_id: VALID_SHELF },
      updateResult: { data: null, error: null },
    });
    const res = await PATCH(context as never);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for missing shelf_id', async () => {
    const { context } = makePatchContext({
      body: {},
      updateResult: { data: null, error: null },
    });
    const res = await PATCH(context as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid JSON body', async () => {
    const { context } = makePatchContext({
      body: 'not json{',
      updateResult: { data: null, error: null },
    });
    const res = await PATCH(context as never);
    expect(res.status).toBe(400);
  });

  it('returns 404 on 23503 FK violation (target shelf missing / not owned)', async () => {
    const { context } = makePatchContext({
      body: { shelf_id: VALID_SHELF },
      updateResult: { data: null, error: { code: '23503', message: 'fk', name: 'PostgrestError' } },
    });
    const res = await PATCH(context as never);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 on PGRST116 (photo not found / RLS scope)', async () => {
    const { context } = makePatchContext({
      body: { shelf_id: VALID_SHELF },
      updateResult: { data: null, error: { code: 'PGRST116', message: 'no rows', name: 'PostgrestError' } },
    });
    const res = await PATCH(context as never);
    expect(res.status).toBe(404);
  });

  it('returns 500 on other supabase errors', async () => {
    const { context } = makePatchContext({
      body: { shelf_id: VALID_SHELF },
      updateResult: { data: null, error: { code: '99999', message: 'misc', name: 'PostgrestError' } },
    });
    const res = await PATCH(context as never);
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/photos/:id', () => {
  it('deletes photo and Storage file, returns 200 with deleted:true', async () => {
    const { context, deleteFn, removeFn, storageFromFn } = makeDeleteContext({
      existing: { id: VALID_ID, storage_path: 'user-1/abc.jpg' },
    });
    const res = await DELETE(context as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { deleted: boolean } };
    expect(json.data.deleted).toBe(true);
    expect(deleteFn).toHaveBeenCalled();
    expect(storageFromFn).toHaveBeenCalledWith('shelf-photos');
    expect(removeFn).toHaveBeenCalledWith(['user-1/abc.jpg']);
  });

  it('returns 401 when unauthenticated', async () => {
    const { context } = makeDeleteContext({ user: null });
    const res = await DELETE(context as never);
    expect(res.status).toBe(401);
  });

  it('returns 404 for malformed UUID', async () => {
    const { context } = makeDeleteContext({ id: 'not-a-uuid' });
    const res = await DELETE(context as never);
    expect(res.status).toBe(404);
  });

  it('returns 404 when photo does not exist (or RLS scoped out)', async () => {
    const { context, deleteFn } = makeDeleteContext({ existing: null });
    const res = await DELETE(context as never);
    expect(res.status).toBe(404);
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it('returns 500 when DB delete fails', async () => {
    const { context } = makeDeleteContext({
      existing: { id: VALID_ID, storage_path: 'user-1/abc.jpg' },
      deleteError: { code: '99999', message: 'fail', name: 'PostgrestError' },
    });
    const res = await DELETE(context as never);
    expect(res.status).toBe(500);
  });

  it('still returns 200 when Storage remove errors (orphan left, logged)', async () => {
    const { context } = makeDeleteContext({
      existing: { id: VALID_ID, storage_path: 'user-1/abc.jpg' },
      removeResult: { error: { message: 'storage down', name: 'StorageError' } },
    });
    const res = await DELETE(context as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { deleted: boolean } };
    expect(json.data.deleted).toBe(true);
  });

  it('still returns 200 when Storage remove throws', async () => {
    const { context } = makeDeleteContext({
      existing: { id: VALID_ID, storage_path: 'user-1/abc.jpg' },
      removeThrows: true,
    });
    const res = await DELETE(context as never);
    expect(res.status).toBe(200);
  });
});
