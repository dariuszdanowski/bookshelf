import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PATCH } from '../../../../../src/pages/api/account/profile';

const USER_ID = '00000000-0000-4000-8000-000000000001';

type Row = { id: string; display_name: string | null };
type QResult = { data: Row | null; error: { code?: string; name?: string; message: string } | null };

// Chainable builder: update/eq/select zwracają siebie; single() → result.
function builder(result: QResult) {
  const b: Record<string, unknown> = {};
  b.update = () => b;
  b.eq = () => b;
  b.select = () => b;
  b.single = () => Promise.resolve(result);
  return b;
}

function makeContext(opts: {
  body?: unknown;
  rawBody?: string;
  result?: QResult;
  user?: { id: string } | null;
}) {
  const fromFn = vi.fn(() => builder(opts.result ?? { data: null, error: null }));

  const body = opts.rawBody ?? JSON.stringify(opts.body ?? {});

  return {
    request: new Request('http://localhost/api/account/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    }),
    locals: {
      supabase: { from: fromFn } as never,
      user: opts.user === undefined ? ({ id: USER_ID } as never) : (opts.user as never),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('PATCH /api/account/profile', () => {
  it('zwraca 200 + zaktualizowany display_name', async () => {
    const ctx = makeContext({
      body: { display_name: 'Nowa Nazwa' },
      result: { data: { id: USER_ID, display_name: 'Nowa Nazwa' }, error: null },
    });

    const res = await PATCH(ctx as never);
    expect(res.status).toBe(200);

    const json = (await res.json()) as { data: { profile: { id: string; display_name: string } } };
    expect(json.data.profile.display_name).toBe('Nowa Nazwa');
    expect(json.data.profile.id).toBe(USER_ID);
  });

  it('zwraca 401 gdy user null', async () => {
    const ctx = makeContext({ body: { display_name: 'X' }, user: null });
    const res = await PATCH(ctx as never);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('UNAUTHENTICATED');
  });

  it('zwraca 400 (VALIDATION_ERROR) gdy display_name pusty', async () => {
    const ctx = makeContext({ body: { display_name: '   ' } });
    const res = await PATCH(ctx as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('zwraca 400 (VALIDATION_ERROR) gdy display_name za długi', async () => {
    const ctx = makeContext({ body: { display_name: 'a'.repeat(101) } });
    const res = await PATCH(ctx as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('zwraca 400 gdy body to nie-JSON', async () => {
    const ctx = makeContext({ rawBody: 'not json' });
    const res = await PATCH(ctx as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('mapuje PGRST116 (0 rows) → 404 NOT_FOUND', async () => {
    const ctx = makeContext({
      body: { display_name: 'X' },
      result: { data: null, error: { code: 'PGRST116', message: 'no rows' } },
    });
    const res = await PATCH(ctx as never);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('mapuje nieoczekiwany błąd DB → 500 INTERNAL_ERROR', async () => {
    const ctx = makeContext({
      body: { display_name: 'X' },
      result: { data: null, error: { code: '08006', name: 'PostgresError', message: 'conn fail' } },
    });
    const res = await PATCH(ctx as never);
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('INTERNAL_ERROR');
  });
});
