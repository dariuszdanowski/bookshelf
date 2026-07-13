import { describe, expect, it, vi } from 'vitest';

import { GET } from '../../../../../src/pages/api/detections/[id]/history';

const DET_ID = '00000000-0000-4000-8000-000000000040';

type ApiJson = { data?: Record<string, unknown>; error?: { code: string; message: string } };

type CorrectionRow = {
  id: string;
  correction_type: string | null;
  original_raw_title: string | null;
  original_raw_author: string | null;
  corrected_title: string | null;
  corrected_authors: string[] | null;
  created_at: string;
};

function makeSupabase(opts: {
  detection?: { id: string } | null;
  detectionError?: { name: string; message: string; code?: string } | null;
  corrections?: CorrectionRow[];
  correctionsError?: { code?: string; message: string } | null;
}) {
  const detection = opts.detection !== undefined ? opts.detection : { id: DET_ID };
  const corrections = opts.corrections ?? [];

  return {
    from: vi.fn((table: string) => {
      if (table === 'detections') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: detection, error: opts.detectionError ?? null }),
            })),
          })),
        };
      }
      if (table === 'corrections') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi
                .fn()
                .mockResolvedValue({ data: corrections, error: opts.correctionsError ?? null }),
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
  user?: boolean;
  supabase?: ReturnType<typeof makeSupabase>;
}) {
  return {
    params: { id: opts.id ?? DET_ID },
    locals: {
      user: opts.user !== false ? { id: 'user-1', email: 'test@test.com' } : null,
      supabase: opts.supabase ?? makeSupabase({}),
    },
  } as never;
}

describe('GET /api/detections/[id]/history', () => {
  it('401 gdy brak użytkownika', async () => {
    const res = await GET(makeContext({ user: false }));
    expect(res.status).toBe(401);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('UNAUTHENTICATED');
  });

  it('404 gdy id nie jest UUID', async () => {
    const res = await GET(makeContext({ id: 'not-a-uuid' }));
    expect(res.status).toBe(404);
  });

  it('404 gdy detekcja nie istnieje / nie należy do usera', async () => {
    const res = await GET(makeContext({ supabase: makeSupabase({ detection: null }) }));
    expect(res.status).toBe(404);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('NOT_FOUND');
  });

  it('500 gdy select detekcji pada', async () => {
    const res = await GET(
      makeContext({
        supabase: makeSupabase({
          detectionError: { name: 'Error', message: 'boom', code: '500' },
        }),
      }),
    );
    expect(res.status).toBe(500);
  });

  it('pusta lista gdy brak korekt', async () => {
    const res = await GET(makeContext({ supabase: makeSupabase({ corrections: [] }) }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!['corrections']).toEqual([]);
  });

  it('zwraca posortowaną chronologicznie listę korekt z original_raw_author', async () => {
    const corrections: CorrectionRow[] = [
      {
        id: 'c1',
        correction_type: 'rematch',
        original_raw_title: 'Marowska Duchowska',
        original_raw_author: null,
        corrected_title: 'Prawdziwy Tytuł',
        corrected_authors: ['Prawdziwy Autor'],
        created_at: '2026-07-13T10:00:00.000Z',
      },
      {
        id: 'c2',
        correction_type: 'refine',
        original_raw_title: 'Prawdziwy Tytuł',
        original_raw_author: 'Prawdziwy Autor',
        corrected_title: 'Prawdziwy Tytuł 2',
        corrected_authors: ['Prawdziwy Autor'],
        created_at: '2026-07-13T11:00:00.000Z',
      },
    ];
    const res = await GET(makeContext({ supabase: makeSupabase({ corrections }) }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    const rows = json.data!['corrections'] as CorrectionRow[];
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe('c1');
    expect(rows[1].id).toBe('c2');
    expect(rows[1].original_raw_author).toBe('Prawdziwy Autor');
  });

  it('500 gdy select corrections pada z błędem innym niż 42703', async () => {
    const res = await GET(
      makeContext({
        supabase: makeSupabase({ correctionsError: { code: '500', message: 'boom' } }),
      }),
    );
    expect(res.status).toBe(500);
  });
});
