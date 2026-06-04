import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PATCH, DELETE } from '../../../../../../src/pages/api/account/keys/[id]';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const KEY_ID = '00000000-0000-4000-8000-000000000002';

const SAMPLE_KEY_ROW = {
  id: KEY_ID,
  label: 'Mój klucz',
  provider: 'anthropic',
  model: null,
  base_url: null,
  is_active: false,
  last_tested_at: null,
  last_test_result: null,
  created_at: '2026-01-01T00:00:00Z',
};

type PgError = { code?: string; message?: string; name?: string } | null;

function makePatchContext(opts: {
  id?: string;
  body?: unknown;
  rawBody?: string;
  fetchResult?: { data?: { id: string; user_id: string } | null; error: PgError };
  deactivateResult?: { error: PgError };
  updateResult?: { data?: typeof SAMPLE_KEY_ROW | null; error: PgError };
  user?: { id: string } | null;
}) {
  const fetchSingleFn = vi.fn().mockResolvedValue(
    opts.fetchResult ?? { data: { id: KEY_ID, user_id: USER_ID }, error: null }
  );
  const fetchEqUser = vi.fn(() => ({ single: fetchSingleFn }));
  const fetchEqId = vi.fn(() => ({ eq: fetchEqUser }));
  const fetchSelectFn = vi.fn(() => ({ eq: fetchEqId }));

  const deactivateNeqFn = vi.fn().mockResolvedValue(
    opts.deactivateResult ?? { error: null }
  );
  const deactivateEqFn = vi.fn(() => ({ neq: deactivateNeqFn }));
  const deactivateUpdateFn = vi.fn(() => ({ eq: deactivateEqFn }));

  const updateSingleFn = vi.fn().mockResolvedValue(
    opts.updateResult ?? { data: SAMPLE_KEY_ROW, error: null }
  );
  const updateSelectFn = vi.fn(() => ({ single: updateSingleFn }));
  const updateEqUserFn = vi.fn(() => ({ select: updateSelectFn }));
  const updateEqIdFn = vi.fn(() => ({ eq: updateEqUserFn }));
  const updateFn = vi.fn(() => ({ eq: updateEqIdFn }));

  let callCount = 0;
  const fromFn = vi.fn(() => {
    callCount++;
    if (callCount === 1) return { select: fetchSelectFn };
    if (callCount === 2 && opts.body && (opts.body as Record<string, unknown>).is_active === true) {
      return { update: deactivateUpdateFn };
    }
    return { update: updateFn };
  });

  const body = opts.rawBody ?? JSON.stringify(opts.body ?? {});

  return {
    params: { id: opts.id ?? KEY_ID },
    request: new Request(`http://localhost/api/account/keys/${opts.id ?? KEY_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    }),
    locals: {
      supabase: { from: fromFn } as never,
      user: opts.user === undefined ? ({ id: USER_ID } as never) : (opts.user as never),
    },
    deactivateNeqFn,
    updateFn,
  };
}

function makeDeleteContext(opts: {
  id?: string;
  deleteResult?: { error: PgError; count?: number };
  user?: { id: string } | null;
}) {
  const eqUserFn = vi.fn().mockResolvedValue(
    opts.deleteResult ?? { error: null, count: 1 }
  );
  const eqIdFn = vi.fn(() => ({ eq: eqUserFn }));
  const deleteFn = vi.fn(() => ({ eq: eqIdFn }));
  const fromFn = vi.fn(() => ({ delete: deleteFn }));

  return {
    params: { id: opts.id ?? KEY_ID },
    locals: {
      supabase: { from: fromFn } as never,
      user: opts.user === undefined ? ({ id: USER_ID } as never) : (opts.user as never),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('PATCH /api/account/keys/[id]', () => {
  it('zwraca 200 + zaktualizowany klucz przy zmianie label', async () => {
    const ctx = makePatchContext({ body: { label: 'Nowa etykieta' } });
    const res = await PATCH(ctx as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { key: { id: string } } };
    expect(json.data.key.id).toBe(KEY_ID);
  });

  it('dezaktywuje inne klucze przed aktywacją', async () => {
    const ctx = makePatchContext({ body: { is_active: true } });
    await PATCH(ctx as never);
    expect(ctx.deactivateNeqFn).toHaveBeenCalledWith('id', KEY_ID);
  });

  it('zwraca 401 gdy user null', async () => {
    const ctx = makePatchContext({ body: { label: 'X' }, user: null });
    const res = await PATCH(ctx as never);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('UNAUTHENTICATED');
  });

  it('zwraca 404 przy nieprawidłowym UUID', async () => {
    const ctx = makePatchContext({ id: 'not-a-uuid', body: { label: 'X' } });
    const res = await PATCH(ctx as never);
    expect(res.status).toBe(404);
  });

  it('zwraca 404 gdy klucz nie istnieje (PGRST116)', async () => {
    const ctx = makePatchContext({
      body: { label: 'X' },
      fetchResult: { data: null, error: { code: 'PGRST116', message: 'no rows' } },
    });
    const res = await PATCH(ctx as never);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('zwraca 400 przy Zod fail (pusty obiekt)', async () => {
    const ctx = makePatchContext({ body: {} });
    const res = await PATCH(ctx as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('DELETE /api/account/keys/[id]', () => {
  it('zwraca 200 gdy klucz usunięty', async () => {
    const ctx = makeDeleteContext({});
    const res = await DELETE(ctx as never);
    expect(res.status).toBe(200);
  });

  it('zwraca 401 gdy user null', async () => {
    const ctx = makeDeleteContext({ user: null });
    const res = await DELETE(ctx as never);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('UNAUTHENTICATED');
  });

  it('zwraca 404 przy 0 usuniętych wierszach', async () => {
    const ctx = makeDeleteContext({ deleteResult: { error: null, count: 0 } });
    const res = await DELETE(ctx as never);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('zwraca 404 przy nieprawidłowym UUID', async () => {
    const ctx = makeDeleteContext({ id: 'invalid' });
    const res = await DELETE(ctx as never);
    expect(res.status).toBe(404);
  });
});
