import { describe, it, expect, vi, beforeEach } from 'vitest';

import { GET } from '../../../../../src/pages/api/account/stats';

const USER_ID = '00000000-0000-4000-8000-000000000001';

type CostRow = { cost_usd: number | null };
type QResult = { data: CostRow[] | null; error: { message: string } | null };

// Chainable + awaitable builder: select/eq zwracają siebie, await → result.
function builder(result: QResult) {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = () => b;
  b.then = (resolve: (v: QResult) => void) => resolve(result);
  return b;
}

function makeContext(opts: {
  vision: QResult;
  refine: QResult;
  user?: { id: string } | null;
}) {
  const fromFn = vi.fn((table: string) =>
    builder(table === 'vision_runs' ? opts.vision : opts.refine)
  );

  return {
    request: new Request('http://localhost/api/account/stats'),
    locals: {
      supabase: { from: fromFn } as never,
      user: opts.user === undefined ? ({ id: USER_ID } as never) : (opts.user as never),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/account/stats', () => {
  it('zwraca sumy kosztów i liczby per user', async () => {
    const ctx = makeContext({
      vision: { data: [{ cost_usd: 0.01 }, { cost_usd: 0.005 }], error: null },
      refine: { data: [{ cost_usd: 0.002 }], error: null },
    });

    const res = await GET(ctx as never);
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      data: { total_vision_cost_usd: number; total_refine_cost_usd: number; vision_run_count: number; refine_call_count: number };
    };
    expect(json.data.total_vision_cost_usd).toBeCloseTo(0.015);
    expect(json.data.total_refine_cost_usd).toBeCloseTo(0.002);
    expect(json.data.vision_run_count).toBe(2);
    expect(json.data.refine_call_count).toBe(1);
  });

  it('NULL cost_usd traktowane jako 0; brak danych → 0', async () => {
    const ctx = makeContext({
      vision: { data: [{ cost_usd: null }, { cost_usd: 0.01 }], error: null },
      refine: { data: [], error: null },
    });

    const res = await GET(ctx as never);
    const json = (await res.json()) as { data: { total_vision_cost_usd: number; refine_call_count: number } };
    expect(json.data.total_vision_cost_usd).toBeCloseTo(0.01);
    expect(json.data.refine_call_count).toBe(0);
  });

  it('zwraca 401 gdy user null', async () => {
    const ctx = makeContext({ vision: { data: [], error: null }, refine: { data: [], error: null }, user: null });
    const res = await GET(ctx as never);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('UNAUTHENTICATED');
  });

  it('zwraca 500 gdy vision_runs query zwróci error', async () => {
    const ctx = makeContext({
      vision: { data: null, error: { message: 'db fail' } },
      refine: { data: [], error: null },
    });
    const res = await GET(ctx as never);
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('INTERNAL_ERROR');
  });
});
