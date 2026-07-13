import { describe, expect, it, vi } from 'vitest';

import { PATCH } from '../../../../../src/pages/api/detections/[id]/candidate';

const DET_ID = '00000000-0000-4000-8000-000000000060';
const CAND_ID = '00000000-0000-4000-8000-000000000061';

type ApiJson = { data?: Record<string, unknown>; error?: { code: string; message: string } };

function makeSupabase(opts: {
  updateResult?: {
    data: { id: string; cover_url: string | null }[] | null;
    error: null | { name: string; message: string; code?: string };
  };
}) {
  const updateResult = opts.updateResult ?? {
    data: [{ id: CAND_ID, cover_url: 'https://example.com/cover.jpg' }],
    error: null,
  };

  return {
    from: vi.fn((table: string) => {
      if (table === 'book_candidates') {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn().mockResolvedValue(updateResult),
              })),
            })),
          })),
        };
      }
      return {};
    }),
  };
}

function makeContext(opts: {
  id?: string;
  body?: unknown;
  user?: boolean;
  supabase?: ReturnType<typeof makeSupabase>;
}) {
  return {
    params: { id: opts.id ?? DET_ID },
    request: {
      json: vi
        .fn()
        .mockResolvedValue(
          opts.body ?? { candidate_id: CAND_ID, cover_url: 'https://example.com/cover.jpg' },
        ),
    },
    locals: {
      user: opts.user !== false ? { id: 'user-1', email: 'test@test.com' } : null,
      supabase: opts.supabase ?? makeSupabase({}),
    },
  } as never;
}

describe('PATCH /api/detections/[id]/candidate', () => {
  it('401 gdy brak użytkownika', async () => {
    const res = await PATCH(makeContext({ user: false }));
    expect(res.status).toBe(401);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('UNAUTHENTICATED');
  });

  it('404 gdy id detekcji nie jest UUID', async () => {
    const res = await PATCH(makeContext({ id: 'not-a-uuid' }));
    expect(res.status).toBe(404);
  });

  it('400 gdy cover_url nie jest poprawnym URL', async () => {
    const res = await PATCH(
      makeContext({ body: { candidate_id: CAND_ID, cover_url: 'not-a-url' } }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('VALIDATION_ERROR');
  });

  it('400 gdy candidate_id nie jest UUID', async () => {
    const res = await PATCH(
      makeContext({ body: { candidate_id: 'not-a-uuid', cover_url: 'https://example.com/x.jpg' } }),
    );
    expect(res.status).toBe(400);
  });

  it('404 gdy kandydat nie istnieje / nie należy do tej detekcji', async () => {
    const supabase = makeSupabase({ updateResult: { data: [], error: null } });
    const res = await PATCH(makeContext({ supabase }));
    expect(res.status).toBe(404);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('NOT_FOUND');
  });

  it('200 aktualizuje cover_url i zwraca nową wartość', async () => {
    const supabase = makeSupabase({
      updateResult: {
        data: [{ id: CAND_ID, cover_url: 'https://example.com/new.jpg' }],
        error: null,
      },
    });
    const res = await PATCH(
      makeContext({
        supabase,
        body: { candidate_id: CAND_ID, cover_url: 'https://example.com/new.jpg' },
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!['candidate_id']).toBe(CAND_ID);
    expect(json.data!['cover_url']).toBe('https://example.com/new.jpg');
  });

  it('200 z cover_url: null czyści okładkę kandydata', async () => {
    const supabase = makeSupabase({
      updateResult: { data: [{ id: CAND_ID, cover_url: null }], error: null },
    });
    const res = await PATCH(
      makeContext({ supabase, body: { candidate_id: CAND_ID, cover_url: null } }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!['cover_url']).toBeNull();
  });

  it('500 gdy update zwraca błąd bazy', async () => {
    const supabase = makeSupabase({
      updateResult: { data: null, error: { name: 'Error', message: 'boom', code: '500' } },
    });
    const res = await PATCH(makeContext({ supabase }));
    expect(res.status).toBe(500);
  });
});
