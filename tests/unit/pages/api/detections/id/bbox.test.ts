import { describe, expect, it, vi } from 'vitest';

import { PATCH } from '../../../../../../src/pages/api/detections/[id]/bbox';

const DET_ID = '00000000-0000-4000-8000-000000000010';

type ApiJson = { data?: Record<string, unknown>; error?: { code: string; message: string } };

function makeContext(opts: {
  id?: string;
  body?: unknown;
  user?: boolean;
  updateResult?: { data: { id: string }[] | null; error: { name: string; message: string; code?: string } | null };
}) {
  const updateResult = opts.updateResult ?? { data: [{ id: DET_ID }], error: null };

  const selectFn = vi.fn().mockResolvedValue(updateResult);
  const eqFn = vi.fn(() => ({ select: selectFn }));
  const updateFn = vi.fn(() => ({ eq: eqFn }));
  const fromFn = vi.fn(() => ({ update: updateFn }));

  return {
    params: { id: opts.id ?? DET_ID },
    request: {
      json: vi.fn().mockResolvedValue(
        opts.body ?? { bbox: { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.9 } }
      ),
    },
    locals: {
      user: opts.user !== false ? { id: 'user-1', email: 'test@test.com' } : null,
      supabase: { from: fromFn } as never,
    },
  } as never;
}

describe('PATCH /api/detections/[id]/bbox', () => {
  it('401 gdy brak użytkownika', async () => {
    const ctx = makeContext({ user: false });
    const res = await PATCH(ctx);
    expect(res.status).toBe(401);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('UNAUTHENTICATED');
  });

  it('404 gdy id nie jest UUID', async () => {
    const ctx = makeContext({ id: 'not-a-uuid' });
    const res = await PATCH(ctx);
    expect(res.status).toBe(404);
  });

  it('400 gdy x1 >= x2', async () => {
    const ctx = makeContext({ body: { bbox: { x1: 0.5, y1: 0.1, x2: 0.3, y2: 0.9 } } });
    const res = await PATCH(ctx);
    expect(res.status).toBe(400);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('VALIDATION_ERROR');
  });

  it('400 gdy y1 >= y2', async () => {
    const ctx = makeContext({ body: { bbox: { x1: 0.1, y1: 0.9, x2: 0.5, y2: 0.2 } } });
    const res = await PATCH(ctx);
    expect(res.status).toBe(400);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('VALIDATION_ERROR');
  });

  it('404 gdy detekcja nie istnieje (puste rows)', async () => {
    const ctx = makeContext({ updateResult: { data: [], error: null } });
    const res = await PATCH(ctx);
    expect(res.status).toBe(404);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('NOT_FOUND');
  });

  it('200 z id i bbox przy sukcesie', async () => {
    const ctx = makeContext({});
    const res = await PATCH(ctx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!.id).toBe(DET_ID);
    expect(json.data!.bbox).toEqual({ x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.9 });
  });

  it('Cache-Control: private, no-store', async () => {
    const ctx = makeContext({});
    const res = await PATCH(ctx);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
