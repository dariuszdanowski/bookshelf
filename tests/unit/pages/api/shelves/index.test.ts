import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from '../../../../../src/pages/api/shelves/index';

type Row = {
  id: string;
  name: string;
  location: string | null;
  position_index: number;
  created_at: string;
};

function makeListContext(rows: Row[] | null, error: { code?: string; message?: string; name?: string } | null = null) {
  const orderFn = vi.fn().mockResolvedValue({ data: rows, error });
  const selectFn = vi.fn(() => ({ order: orderFn }));
  const fromFn = vi.fn(() => ({ select: selectFn }));
  return {
    context: {
      locals: {
        supabase: { from: fromFn } as never,
        user: { id: 'user-1', email: 't@test' } as never,
      },
    },
    fromFn,
  };
}

function makeCreateContext(opts: {
  body: unknown;
  insertResult: { data: Row | null; error: { code?: string; message?: string; name?: string } | null };
  user?: { id: string; email: string } | null;
}) {
  const singleFn = vi.fn().mockResolvedValue(opts.insertResult);
  const selectFn = vi.fn(() => ({ single: singleFn }));
  const insertFn = vi.fn(() => ({ select: selectFn }));
  const fromFn = vi.fn(() => ({ insert: insertFn }));
  const request = new Request('http://localhost/api/shelves', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
  });
  return {
    context: {
      request,
      locals: {
        supabase: { from: fromFn } as never,
        user: opts.user === undefined ? ({ id: 'user-1', email: 't@test' } as never) : (opts.user as never),
      },
    },
    insertFn,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/shelves', () => {
  it('returns sorted shelves with "Zakupione" first, then alphabetical', async () => {
    const rows: Row[] = [
      {
        id: 'a-id',
        name: 'Belletrystyka',
        location: null,
        position_index: 0,
        created_at: '2026-05-26T10:00:00Z',
      },
      {
        id: 'z-id',
        name: 'Zakupione',
        location: null,
        position_index: 0,
        created_at: '2026-05-26T08:00:00Z',
      },
      {
        id: 'n-id',
        name: 'Nauka',
        location: 'Gabinet',
        position_index: 0,
        created_at: '2026-05-26T09:00:00Z',
      },
    ];
    const { context } = makeListContext(rows);

    const res = await GET(context as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');

    const json = (await res.json()) as { data: { shelves: { name: string; is_system: boolean; book_count: number }[] } };
    expect(json.data.shelves).toHaveLength(3);
    expect(json.data.shelves[0]).toMatchObject({ name: 'Zakupione', is_system: true, book_count: 0 });
    expect(json.data.shelves[1]).toMatchObject({ name: 'Belletrystyka', is_system: false });
    expect(json.data.shelves[2]).toMatchObject({ name: 'Nauka', is_system: false });
  });

  it('returns empty list for user with no shelves', async () => {
    const { context } = makeListContext([]);
    const res = await GET(context as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { shelves: unknown[] } };
    expect(json.data.shelves).toEqual([]);
  });

  it('returns 500 INTERNAL_ERROR on supabase error', async () => {
    const { context } = makeListContext(null, { name: 'PostgrestError', message: 'oops', code: 'XXXXX' });
    const res = await GET(context as never);
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('POST /api/shelves', () => {
  const validRow: Row = {
    id: 'new-id',
    name: 'Test',
    location: null,
    position_index: 0,
    created_at: '2026-05-26T12:00:00Z',
  };

  it('creates shelf with name only and returns 201', async () => {
    const { context, insertFn } = makeCreateContext({
      body: { name: 'Test' },
      insertResult: { data: validRow, error: null },
    });

    const res = await POST(context as never);
    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { shelf: { name: string; is_system: boolean; book_count: number } } };
    expect(json.data.shelf.name).toBe('Test');
    expect(json.data.shelf.is_system).toBe(false);
    expect(json.data.shelf.book_count).toBe(0);
    expect(insertFn).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-1', name: 'Test', location: null }));
  });

  it('returns 400 VALIDATION_ERROR for malformed JSON', async () => {
    const { context } = makeCreateContext({
      body: 'not-json',
      insertResult: { data: null, error: null },
    });
    const res = await POST(context as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR for invalid Zod input', async () => {
    const { context } = makeCreateContext({
      body: { name: '' },
      insertResult: { data: null, error: null },
    });
    const res = await POST(context as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string; details?: unknown } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.details).toBeDefined();
  });

  it('rejects reserved name "Zakupione" via Zod (defense in depth)', async () => {
    const { context, insertFn } = makeCreateContext({
      body: { name: 'Zakupione' },
      insertResult: { data: null, error: null },
    });
    const res = await POST(context as never);
    expect(res.status).toBe(400);
    expect(insertFn).not.toHaveBeenCalled(); // Zod rejected przed DB call.
  });

  it('returns 400 with "już istnieje" on Postgres 23505 (unique violation)', async () => {
    const { context } = makeCreateContext({
      body: { name: 'Dup' },
      insertResult: { data: null, error: { code: '23505', message: 'unique violation', name: 'PostgrestError' } },
    });
    const res = await POST(context as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.message).toMatch(/już istnieje/);
  });

  it('returns 401 UNAUTHENTICATED when locals.user is null (defensive)', async () => {
    const { context } = makeCreateContext({
      body: { name: 'OK' },
      insertResult: { data: null, error: null },
      user: null,
    });
    const res = await POST(context as never);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns 500 INTERNAL_ERROR on other supabase errors', async () => {
    const { context } = makeCreateContext({
      body: { name: 'OK' },
      insertResult: { data: null, error: { code: '99999', message: 'misc', name: 'PostgrestError' } },
    });
    const res = await POST(context as never);
    expect(res.status).toBe(500);
  });
});
