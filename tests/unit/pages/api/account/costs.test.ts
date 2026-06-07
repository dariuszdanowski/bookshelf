import { describe, it, expect, vi, beforeEach } from 'vitest';

import { GET } from '../../../../../src/pages/api/account/costs';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const KEY_A = '00000000-0000-4000-8000-00000000a001';

type CostEventRow = {
  id: string;
  kind: string;
  model: string | null;
  cost_usd: number | null;
  latency_ms: number | null;
  created_at: string;
  api_key_id: string | null;
  photo_id: string | null;
  detection_id: string | null;
  raw_title: string | null;
};
type PageResult = {
  data: CostEventRow[] | null;
  count: number | null;
  error: { message: string } | null;
};
type SumResult = { data: { cost_usd: number | null }[] | null; error: { message: string } | null };

/**
 * Chainable + awaitable builder dla cost_events.
 * select() → zwraca siebie; eq/is/gte/order/range → zwracają siebie.
 * await (then) → pageResult (pierwsze) lub sumResult (drugie wywołanie).
 */
function makeBuilder(pageResult: PageResult, sumResult: SumResult) {
  let callCount = 0;

  function chain(): Record<string, unknown> {
    let capturedSelect: string | undefined;
    const b: Record<string, (...args: unknown[]) => unknown> = {};
    const self = b;
    self.select = (cols: unknown, _opts?: unknown) => {
      capturedSelect = typeof cols === 'string' ? cols : undefined;
      return self;
    };
    self.eq = () => self;
    self.is = () => self;
    self.gte = () => self;
    self.order = () => self;
    self.range = () => self;
    (self as Record<string, unknown>).then = (resolve: (v: unknown) => void) => {
      callCount++;
      // page query uses '*' select, sum query uses 'cost_usd'
      if (capturedSelect === 'cost_usd') {
        resolve(sumResult);
      } else {
        resolve(pageResult);
      }
    };
    return self as Record<string, unknown>;
  }

  return { from: vi.fn(() => chain()), _callCount: () => callCount };
}

function makeCtx(
  search: string,
  pageResult: PageResult,
  sumResult: SumResult,
  user?: { id: string } | null,
) {
  const sb = makeBuilder(pageResult, sumResult);
  return {
    request: new Request(`http://localhost/api/account/costs${search}`),
    locals: {
      supabase: sb as never,
      user: user === undefined ? ({ id: USER_ID } as never) : (user as never),
    },
  };
}

const defaultItems: CostEventRow[] = [
  {
    id: 'aa000000-0000-4000-8000-000000000001',
    kind: 'vision',
    model: 'claude-3-5-sonnet',
    cost_usd: 0.01,
    latency_ms: 1200,
    created_at: '2026-06-01T10:00:00Z',
    api_key_id: KEY_A,
    photo_id: 'pp000000-0000-4000-8000-000000000001',
    detection_id: null,
    raw_title: null,
  },
  {
    id: 'aa000000-0000-4000-8000-000000000002',
    kind: 'refine',
    model: 'claude-3-5-sonnet',
    cost_usd: 0.002,
    latency_ms: 800,
    created_at: '2026-06-01T09:00:00Z',
    api_key_id: null,
    photo_id: 'pp000000-0000-4000-8000-000000000001',
    detection_id: 'dd000000-0000-4000-8000-000000000001',
    raw_title: 'Pan Tadeusz',
  },
];

beforeEach(() => vi.clearAllMocks());

describe('GET /api/account/costs', () => {
  it('zwraca 401 gdy brak usera', async () => {
    const ctx = makeCtx('', { data: [], count: 0, error: null }, { data: [], error: null }, null);
    const res = await GET(ctx as never);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('UNAUTHENTICATED');
  });

  it('default (brak filtrów, strona 1) — zwraca items + meta', async () => {
    const ctx = makeCtx(
      '',
      { data: defaultItems, count: 2, error: null },
      { data: [{ cost_usd: 0.01 }, { cost_usd: 0.002 }], error: null },
    );
    const res = await GET(ctx as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        items: unknown[];
        page: number;
        page_size: number;
        total_count: number;
        total_cost_usd: number;
      };
    };
    expect(json.data.items).toHaveLength(2);
    expect(json.data.page).toBe(1);
    expect(json.data.page_size).toBe(25);
    expect(json.data.total_count).toBe(2);
    expect(json.data.total_cost_usd).toBeCloseTo(0.012);
  });

  it('total_cost_usd: NULL cost_usd traktowane jako 0', async () => {
    const ctx = makeCtx(
      '',
      { data: defaultItems, count: 2, error: null },
      { data: [{ cost_usd: 0.01 }, { cost_usd: null }], error: null },
    );
    const res = await GET(ctx as never);
    const json = (await res.json()) as { data: { total_cost_usd: number } };
    expect(json.data.total_cost_usd).toBeCloseTo(0.01);
  });

  it('filtr key=<uuid> — żądanie przechodzi walidację', async () => {
    const ctx = makeCtx(
      `?key=${KEY_A}`,
      { data: [defaultItems[0]], count: 1, error: null },
      { data: [{ cost_usd: 0.01 }], error: null },
    );
    const res = await GET(ctx as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { items: unknown[] } };
    expect(json.data.items).toHaveLength(1);
  });

  it('filtr key=none — żądanie przechodzi walidację', async () => {
    const ctx = makeCtx(
      '?key=none',
      { data: [defaultItems[1]], count: 1, error: null },
      { data: [{ cost_usd: 0.002 }], error: null },
    );
    const res = await GET(ctx as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { total_cost_usd: number } };
    expect(json.data.total_cost_usd).toBeCloseTo(0.002);
  });

  it('filtr type=vision — zwraca items', async () => {
    const ctx = makeCtx(
      '?type=vision',
      { data: [defaultItems[0]], count: 1, error: null },
      { data: [{ cost_usd: 0.01 }], error: null },
    );
    const res = await GET(ctx as never);
    expect(res.status).toBe(200);
  });

  it('filtr period=7d — zwraca items', async () => {
    const ctx = makeCtx(
      '?period=7d',
      { data: defaultItems, count: 2, error: null },
      { data: [{ cost_usd: 0.012 }], error: null },
    );
    const res = await GET(ctx as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { total_count: number } };
    expect(json.data.total_count).toBe(2);
  });

  it('filtr period=30d — zwraca items', async () => {
    const ctx = makeCtx(
      '?period=30d',
      { data: defaultItems, count: 2, error: null },
      { data: [{ cost_usd: 0.012 }], error: null },
    );
    const res = await GET(ctx as never);
    expect(res.status).toBe(200);
  });

  it('paginacja page=2 — range (25,49)', async () => {
    // Weryfikacja że strona 2 zwraca poprawne meta
    const ctx = makeCtx(
      '?page=2',
      { data: [], count: 30, error: null },
      { data: [{ cost_usd: 0.1 }], error: null },
    );
    const res = await GET(ctx as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { page: number; total_count: number; items: unknown[] };
    };
    expect(json.data.page).toBe(2);
    expect(json.data.total_count).toBe(30);
    expect(json.data.items).toHaveLength(0); // poza zakresem w mocy → pusta lista, nie błąd
  });

  it('page poza zakresem → pusta lista, nie błąd', async () => {
    const ctx = makeCtx(
      '?page=99',
      { data: [], count: 10, error: null },
      { data: [], error: null },
    );
    const res = await GET(ctx as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { items: unknown[] } };
    expect(json.data.items).toHaveLength(0);
  });

  it('400 na zły page (0)', async () => {
    const ctx = makeCtx('?page=0', { data: [], count: 0, error: null }, { data: [], error: null });
    const res = await GET(ctx as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 na zły page (string nie-numeryczny)', async () => {
    const ctx = makeCtx(
      '?page=abc',
      { data: [], count: 0, error: null },
      { data: [], error: null },
    );
    const res = await GET(ctx as never);
    expect(res.status).toBe(400);
  });

  it('400 na zły key (nie UUID i nie "none")', async () => {
    const ctx = makeCtx(
      '?key=not-a-uuid',
      { data: [], count: 0, error: null },
      { data: [], error: null },
    );
    const res = await GET(ctx as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('500 gdy page query zwróci error DB', async () => {
    const ctx = makeCtx(
      '',
      { data: null, count: null, error: { message: 'db fail' } },
      { data: [], error: null },
    );
    const res = await GET(ctx as never);
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('INTERNAL_ERROR');
  });

  it('500 gdy sum query zwróci error DB', async () => {
    const ctx = makeCtx(
      '',
      { data: defaultItems, count: 2, error: null },
      { data: null, error: { message: 'sum fail' } },
    );
    const res = await GET(ctx as never);
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('INTERNAL_ERROR');
  });

  it('items mają poprawne pola — link zdjęcia i raw_title dla OCR', async () => {
    const ctx = makeCtx(
      '',
      { data: defaultItems, count: 2, error: null },
      { data: [{ cost_usd: 0.012 }], error: null },
    );
    const res = await GET(ctx as never);
    const json = (await res.json()) as {
      data: {
        items: {
          kind: string;
          photo_id: string | null;
          detection_id: string | null;
          raw_title: string | null;
        }[];
      };
    };
    const vision = json.data.items.find((i) => i.kind === 'vision');
    expect(vision?.photo_id).toBeTruthy();
    expect(vision?.detection_id).toBeNull();

    const refine = json.data.items.find((i) => i.kind === 'refine');
    expect(refine?.raw_title).toBe('Pan Tadeusz');
    expect(refine?.detection_id).toBeTruthy();
  });
});
