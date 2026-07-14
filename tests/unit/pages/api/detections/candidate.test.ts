import { describe, expect, it, vi } from 'vitest';

import { PATCH } from '../../../../../src/pages/api/detections/[id]/candidate';

const DET_ID = '00000000-0000-4000-8000-000000000060';
const CAND_ID = '00000000-0000-4000-8000-000000000061';

type ApiJson = { data?: Record<string, unknown>; error?: { code: string; message: string } };

type CandidateRow = {
  id: string;
  title?: string;
  authors?: string[];
  isbn_13?: string | null;
  isbn_10?: string | null;
  publisher?: string | null;
  published_year?: number | null;
  cover_url?: string | null;
  purchase_date?: string | null;
  purchase_price?: number | null;
  purchase_city?: string | null;
  purchase_event?: string | null;
};

function makeSupabase(opts: {
  updateResult?: {
    data: CandidateRow[] | null;
    error: null | { name: string; message: string; code?: string };
  };
  captureUpdate?: (patch: Record<string, unknown>) => void;
}) {
  const updateResult = opts.updateResult ?? {
    data: [{ id: CAND_ID, cover_url: 'https://example.com/cover.jpg' }],
    error: null,
  };

  return {
    from: vi.fn((table: string) => {
      if (table === 'book_candidates') {
        return {
          update: vi.fn((patch: Record<string, unknown>) => {
            opts.captureUpdate?.(patch);
            return {
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  select: vi.fn().mockResolvedValue(updateResult),
                })),
              })),
            };
          }),
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

  it('200 zapisuje tytuł/autorów/wydawcę/rok/ISBN i zwraca echo pól', async () => {
    const updatedRow: CandidateRow = {
      id: CAND_ID,
      title: 'Poprawiony tytuł',
      authors: ['Nowy Autor'],
      publisher: 'Wydawnictwo X',
      published_year: 1999,
      isbn_13: '9788307032610',
      isbn_10: '830703261X',
    };
    const supabase = makeSupabase({ updateResult: { data: [updatedRow], error: null } });
    const res = await PATCH(
      makeContext({
        supabase,
        body: {
          candidate_id: CAND_ID,
          title: 'Poprawiony tytuł',
          authors: ['Nowy Autor'],
          publisher: 'Wydawnictwo X',
          published_year: 1999,
          isbn_13: '9788307032610',
          isbn_10: '830703261X',
        },
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!['title']).toBe('Poprawiony tytuł');
    expect(json.data!['authors']).toEqual(['Nowy Autor']);
    expect(json.data!['publisher']).toBe('Wydawnictwo X');
    expect(json.data!['published_year']).toBe(1999);
    expect(json.data!['isbn_13']).toBe('9788307032610');
    expect(json.data!['isbn_10']).toBe('830703261X');
  });

  it('200 zapisuje dane zakupu (purchase_date/price/city/event)', async () => {
    const updatedRow: CandidateRow = {
      id: CAND_ID,
      purchase_date: '2026-05-29',
      purchase_price: 42.5,
      purchase_city: 'Kraków',
      purchase_event: 'Targi Książki',
    };
    const supabase = makeSupabase({ updateResult: { data: [updatedRow], error: null } });
    const res = await PATCH(
      makeContext({
        supabase,
        body: {
          candidate_id: CAND_ID,
          purchase_date: '2026-05-29',
          purchase_price: 42.5,
          purchase_city: 'Kraków',
          purchase_event: 'Targi Książki',
        },
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!['purchase_date']).toBe('2026-05-29');
    expect(json.data!['purchase_price']).toBe(42.5);
    expect(json.data!['purchase_city']).toBe('Kraków');
    expect(json.data!['purchase_event']).toBe('Targi Książki');
  });

  it('400 gdy body nie ma żadnego pola poza candidate_id', async () => {
    const res = await PATCH(makeContext({ body: { candidate_id: CAND_ID } }));
    expect(res.status).toBe(400);
  });

  it('zawsze ustawia edited_at w update, niezależnie od tego które pola przyszły', async () => {
    let captured: Record<string, unknown> | undefined;
    const supabase = makeSupabase({
      captureUpdate: (patch) => {
        captured = patch;
      },
    });
    await PATCH(makeContext({ supabase, body: { candidate_id: CAND_ID, title: 'Tylko tytuł' } }));
    expect(captured).toBeDefined();
    expect(captured!['edited_at']).toEqual(expect.any(String));
    expect(captured!['title']).toBe('Tylko tytuł');
    expect(captured!['authors']).toBeUndefined();
  });
});
