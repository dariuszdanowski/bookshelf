import { describe, it, expect, vi, beforeEach } from 'vitest';

import { POST } from '../../../../../src/pages/api/account/reset-resolution-usage';

const USER_ID = '00000000-0000-4000-8000-000000000001';

type QResult = {
  data: { ai_resolution_daily_reset_at: string } | null;
  error: { code?: string; name?: string; message: string } | null;
};

function builder(result: QResult) {
  const b: Record<string, unknown> = {};
  b.update = () => b;
  b.eq = () => b;
  b.select = () => b;
  b.single = () => Promise.resolve(result);
  return b;
}

function makeContext(opts: { result?: QResult; user?: { id: string } | null }) {
  const fromFn = vi.fn(() =>
    builder(
      opts.result ?? {
        data: { ai_resolution_daily_reset_at: '2026-07-16T12:00:00.000Z' },
        error: null,
      },
    ),
  );

  return {
    locals: {
      supabase: { from: fromFn } as never,
      user: opts.user === undefined ? ({ id: USER_ID } as never) : (opts.user as never),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('POST /api/account/reset-resolution-usage', () => {
  it('zwraca 200 + reset_at', async () => {
    const res = await POST(makeContext({}) as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { reset_at: string } };
    expect(json.data.reset_at).toBe('2026-07-16T12:00:00.000Z');
  });

  it('zwraca 401 gdy niezalogowany', async () => {
    const res = await POST(makeContext({ user: null }) as never);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('UNAUTHENTICATED');
  });

  it('mapuje błąd DB → 500 INTERNAL_ERROR', async () => {
    const res = await POST(
      makeContext({
        result: {
          data: null,
          error: { code: '08006', name: 'PostgresError', message: 'conn fail' },
        },
      }) as never,
    );
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('INTERNAL_ERROR');
  });
});
