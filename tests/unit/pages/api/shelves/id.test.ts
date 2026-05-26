import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DELETE, PATCH } from '../../../../../src/pages/api/shelves/[id]';

type Row = {
  id: string;
  name: string;
  location: string | null;
  position_index: number;
  created_at: string;
};

type PgError = { code?: string; message?: string; name?: string } | null;

function makePatchContext(opts: {
  id?: string;
  body: unknown;
  updateResult: { data: Row | null; error: PgError };
}) {
  const singleFn = vi.fn().mockResolvedValue(opts.updateResult);
  const selectFn = vi.fn(() => ({ single: singleFn }));
  const eqFn = vi.fn(() => ({ select: selectFn }));
  const updateFn = vi.fn(() => ({ eq: eqFn }));
  const fromFn = vi.fn(() => ({ update: updateFn }));
  const request = new Request(`http://localhost/api/shelves/${opts.id ?? '12345678-1234-1234-1234-123456789012'}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
  });
  return {
    context: {
      request,
      params: { id: opts.id ?? '12345678-1234-1234-1234-123456789012' },
      locals: {
        supabase: { from: fromFn } as never,
        user: { id: 'user-1', email: 't@test' } as never,
      },
    },
    updateFn,
  };
}

function makeDeleteContext(opts: {
  id?: string;
  existing?: { id: string } | null;
  existingError?: PgError;
  deleteError?: PgError;
}) {
  const maybeSingleFn = vi.fn().mockResolvedValue({
    data: opts.existing === undefined ? { id: 'x' } : opts.existing,
    error: opts.existingError ?? null,
  });
  const selectEqFn = vi.fn(() => ({ maybeSingle: maybeSingleFn }));
  const selectFn = vi.fn(() => ({ eq: selectEqFn }));

  const deleteEqFn = vi.fn().mockResolvedValue({ error: opts.deleteError ?? null });
  const deleteFn = vi.fn(() => ({ eq: deleteEqFn }));

  // Build `from('shelves')` chain: first call → select chain; second call → delete chain.
  let callCount = 0;
  const fromFn = vi.fn(() => {
    callCount += 1;
    return callCount === 1 ? { select: selectFn } : { delete: deleteFn };
  });

  return {
    context: {
      params: { id: opts.id ?? '12345678-1234-1234-1234-123456789012' },
      locals: {
        supabase: { from: fromFn } as never,
        user: { id: 'user-1', email: 't@test' } as never,
      },
    },
    deleteFn,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('PATCH /api/shelves/:id', () => {
  const validRow: Row = {
    id: '12345678-1234-1234-1234-123456789012',
    name: 'Nowa nazwa',
    location: 'Salon',
    position_index: 0,
    created_at: '2026-05-26T12:00:00Z',
  };

  it('updates shelf and returns 200', async () => {
    const { context, updateFn } = makePatchContext({
      body: { name: 'Nowa nazwa', location: 'Salon' },
      updateResult: { data: validRow, error: null },
    });
    const res = await PATCH(context as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { shelf: { name: string; location: string } } };
    expect(json.data.shelf.name).toBe('Nowa nazwa');
    expect(updateFn).toHaveBeenCalledWith(expect.objectContaining({ name: 'Nowa nazwa', location: 'Salon' }));
  });

  it('returns 404 NOT_FOUND for malformed UUID', async () => {
    const { context } = makePatchContext({
      id: 'not-a-uuid',
      body: { name: 'OK' },
      updateResult: { data: null, error: null },
    });
    const res = await PATCH(context as never);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 VALIDATION_ERROR for empty patch object', async () => {
    const { context } = makePatchContext({
      body: {},
      updateResult: { data: null, error: null },
    });
    const res = await PATCH(context as never);
    expect(res.status).toBe(400);
  });

  it('returns 400 with trigger message on P0001 (Zakupione rename block)', async () => {
    const { context } = makePatchContext({
      body: { name: 'Wishlist' },
      updateResult: { data: null, error: { code: 'P0001', message: 'Nie można zmienić nazwy systemowej półki "Zakupione"', name: 'PostgrestError' } },
    });
    const res = await PATCH(context as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.message).toMatch(/Zakupione/);
  });

  it('returns 400 "już istnieje" on 23505 unique violation', async () => {
    const { context } = makePatchContext({
      body: { name: 'Inna' },
      updateResult: { data: null, error: { code: '23505', message: 'dup', name: 'PostgrestError' } },
    });
    const res = await PATCH(context as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toMatch(/już istnieje/);
  });

  it('returns 404 on PGRST116 (no rows updated — RLS scope or not found)', async () => {
    const { context } = makePatchContext({
      body: { name: 'OK' },
      updateResult: { data: null, error: { code: 'PGRST116', message: 'no rows', name: 'PostgrestError' } },
    });
    const res = await PATCH(context as never);
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/shelves/:id', () => {
  it('deletes shelf and returns 200 with deleted:true', async () => {
    const { context, deleteFn } = makeDeleteContext({ existing: { id: 'x' } });
    const res = await DELETE(context as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { deleted: boolean } };
    expect(json.data.deleted).toBe(true);
    expect(deleteFn).toHaveBeenCalled();
  });

  it('returns 404 for malformed UUID', async () => {
    const { context } = makeDeleteContext({ id: 'not-a-uuid' });
    const res = await DELETE(context as never);
    expect(res.status).toBe(404);
  });

  it('returns 404 when shelf does not exist (or RLS scoped out)', async () => {
    const { context } = makeDeleteContext({ existing: null });
    const res = await DELETE(context as never);
    expect(res.status).toBe(404);
  });

  it('returns 400 with trigger message on P0001 (Zakupione delete block)', async () => {
    const { context } = makeDeleteContext({
      existing: { id: 'x' },
      deleteError: { code: 'P0001', message: 'Nie można usunąć systemowej półki "Zakupione"', name: 'PostgrestError' },
    });
    const res = await DELETE(context as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.message).toMatch(/Zakupione/);
  });

  it('returns 500 on other supabase errors', async () => {
    const { context } = makeDeleteContext({
      existing: { id: 'x' },
      deleteError: { code: '99999', message: 'misc', name: 'PostgrestError' },
    });
    const res = await DELETE(context as never);
    expect(res.status).toBe(500);
  });
});
