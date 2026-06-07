import { describe, it, expect, vi, beforeEach } from 'vitest';

import { GET } from '../../../../../src/pages/api/account/stats';

const USER_ID = '00000000-0000-4000-8000-000000000001';

type CostRow = { cost_usd: number | null; api_key_id?: string | null };
type QResult = { data: CostRow[] | null; error: { code?: string; message: string } | null };

// Chainable + awaitable builder: select/eq zwracają siebie, await → result.
function builder(result: QResult) {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = () => b;
  b.then = (resolve: (v: QResult) => void) => resolve(result);
  return b;
}

function makeContext(opts: { vision: QResult; refine: QResult; user?: { id: string } | null }) {
  const fromFn = vi.fn((table: string) =>
    builder(table === 'vision_runs' ? opts.vision : opts.refine),
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
      data: {
        total_vision_cost_usd: number;
        total_refine_cost_usd: number;
        vision_run_count: number;
        refine_call_count: number;
      };
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
    const json = (await res.json()) as {
      data: { total_vision_cost_usd: number; refine_call_count: number };
    };
    expect(json.data.total_vision_cost_usd).toBeCloseTo(0.01);
    expect(json.data.refine_call_count).toBe(0);
  });

  it('zwraca 401 gdy user null', async () => {
    const ctx = makeContext({
      vision: { data: [], error: null },
      refine: { data: [], error: null },
      user: null,
    });
    const res = await GET(ctx as never);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('UNAUTHENTICATED');
  });

  // M27: agregacja kosztów per klucz (vision + refine razem)
  it('M27: cost_by_key sumuje vision+refine per api_key_id; bez atrybucji pomija', async () => {
    const KEY_A = '00000000-0000-4000-8000-00000000k0a1';
    const KEY_B = '00000000-0000-4000-8000-00000000k0b2';
    const ctx = makeContext({
      vision: {
        data: [
          { cost_usd: 0.01, api_key_id: KEY_A },
          { cost_usd: 0.005, api_key_id: KEY_B },
          { cost_usd: 0.02, api_key_id: null }, // historyczny, bez atrybucji
        ],
        error: null,
      },
      refine: { data: [{ cost_usd: 0.002, api_key_id: KEY_A }], error: null },
    });

    const res = await GET(ctx as never);
    const json = (await res.json()) as {
      data: { cost_by_key: Record<string, { cost_usd: number; call_count: number }> };
    };
    expect(json.data.cost_by_key[KEY_A].cost_usd).toBeCloseTo(0.012);
    expect(json.data.cost_by_key[KEY_A].call_count).toBe(2);
    expect(json.data.cost_by_key[KEY_B].cost_usd).toBeCloseTo(0.005);
    expect(Object.keys(json.data.cost_by_key)).toHaveLength(2);
  });

  it('M27: defensywny retry bez api_key_id przy 42703 (prod przed migracją 0020)', async () => {
    // Pierwszy select (z api_key_id) → 42703; retry (bez) → dane
    let visionCalls = 0;
    const fromFn = vi.fn((table: string) => {
      const b: Record<string, unknown> = {};
      b.select = (cols: string) => {
        if (table === 'vision_runs') visionCalls++;
        b._fail = cols.includes('api_key_id');
        return b;
      };
      b.eq = () => b;
      b.then = (resolve: (v: QResult) => void) =>
        resolve(
          (b._fail as boolean)
            ? { data: null, error: { code: '42703', message: 'column does not exist' } }
            : { data: [{ cost_usd: 0.01 }], error: null },
        );
      return b;
    });
    const ctx = {
      request: new Request('http://localhost/api/account/stats'),
      locals: { supabase: { from: fromFn } as never, user: { id: USER_ID } as never },
    };

    const res = await GET(ctx as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { total_vision_cost_usd: number; cost_by_key: Record<string, unknown> };
    };
    expect(json.data.total_vision_cost_usd).toBeCloseTo(0.01);
    expect(visionCalls).toBe(2); // z api_key_id + retry bez
    expect(Object.keys(json.data.cost_by_key)).toHaveLength(0);
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
