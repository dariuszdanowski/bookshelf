import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock confirmDetectionToCatalog (helper) — używane przez confirm i correct
// ---------------------------------------------------------------------------
const mockConfirmDetectionToCatalog = vi.hoisted(() => vi.fn());

vi.mock('../../../../../src/lib/books/confirm', () => ({
  confirmDetectionToCatalog: mockConfirmDetectionToCatalog,
}));

import { POST as confirmPost } from '../../../../../src/pages/api/detections/[id]/confirm';
import { POST as rejectPost } from '../../../../../src/pages/api/detections/[id]/reject';
import { POST as unrejectPost } from '../../../../../src/pages/api/detections/[id]/unreject';
import { POST as correctPost } from '../../../../../src/pages/api/detections/[id]/correct';

// ---------------------------------------------------------------------------
// Stałe testowe
// ---------------------------------------------------------------------------
const USER_ID = '00000000-0000-4000-8000-000000000001';
const DET_ID = '00000000-0000-4000-8000-000000000010';
const CAND_ID = '00000000-0000-4000-8000-000000000020';
const PHOTO_ID = '00000000-0000-4000-8000-000000000030';
const SHELF_ID = '00000000-0000-4000-8000-000000000040';
const BOOK_ID = '00000000-0000-4000-8000-000000000050';

const detectionRow = {
  id: DET_ID,
  status: 'matched',
  photo_id: PHOTO_ID,
  position_index: 2,
  raw_title: 'Solaris',
};

const candidateRow = {
  id: CAND_ID,
  source: 'google_books',
  external_id: 'gb-123',
  title: 'Solaris',
  authors: ['Stanisław Lem'],
  isbn_10: null,
  isbn_13: '9780156027601',
  publisher: 'Harvest',
  published_year: 1961,
  cover_url: null,
};

const photoRow = { shelf_id: SHELF_ID };

// ---------------------------------------------------------------------------
// Helpers — konteksty
// ---------------------------------------------------------------------------

type PgError = { code?: string; name: string; message: string } | null;
type ApiJson = { data?: Record<string, unknown>; error?: { code: string; message: string } };

function makeContext(opts: {
  id?: string;
  body?: unknown;
  detResult?: { data: typeof detectionRow | null; error: PgError };
  photoResult?: { data: typeof photoRow | null; error: PgError };
  candResult?: { data: typeof candidateRow | null; error: PgError };
  user?: boolean;
}) {
  const detResult = opts.detResult ?? { data: detectionRow, error: null };
  const photoResult = opts.photoResult ?? { data: photoRow, error: null };
  const candResult = opts.candResult ?? { data: candidateRow, error: null };

  const fromMock = vi.fn((table: string) => {
    if (table === 'detections') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue(detResult),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    }
    if (table === 'photos') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue(photoResult),
          })),
        })),
      };
    }
    if (table === 'book_candidates') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue(candResult),
            })),
          })),
        })),
      };
    }
    if (table === 'corrections') {
      return {
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    }
    return {};
  });

  return {
    params: { id: opts.id ?? DET_ID },
    request: {
      json: vi.fn().mockResolvedValue(opts.body ?? { candidate_id: CAND_ID }),
    },
    locals: {
      user: opts.user !== false ? { id: USER_ID, email: 'test@example.com' } : null,
      supabase: { from: fromMock } as never,
    },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default helper behavior: sukces
  mockConfirmDetectionToCatalog.mockResolvedValue({ ok: true, bookId: BOOK_ID });
});

// ===========================================================================
// CONFIRM endpoint
// ===========================================================================

describe('POST /api/detections/[id]/confirm', () => {
  it('401 gdy brak użytkownika', async () => {
    const ctx = makeContext({ user: false });
    const res = await confirmPost(ctx);
    expect(res.status).toBe(401);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('UNAUTHENTICATED');
  });

  it('404 gdy id nie jest UUID', async () => {
    const ctx = makeContext({ id: 'bad-uuid' });
    const res = await confirmPost(ctx);
    expect(res.status).toBe(404);
  });

  it('400 gdy brak candidate_id w body', async () => {
    const ctx = makeContext({ body: {} });
    const res = await confirmPost(ctx);
    expect(res.status).toBe(400);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('VALIDATION_ERROR');
  });

  it('404 gdy detekcja nie istnieje (RLS lub brak)', async () => {
    const ctx = makeContext({ detResult: { data: null, error: null } });
    const res = await confirmPost(ctx);
    expect(res.status).toBe(404);
  });

  it('404 gdy zdjęcie nie istnieje', async () => {
    const ctx = makeContext({ photoResult: { data: null, error: null } });
    const res = await confirmPost(ctx);
    expect(res.status).toBe(404);
  });

  it('404 gdy kandydat nie istnieje lub nie należy do detekcji', async () => {
    const ctx = makeContext({ candResult: { data: null, error: null } });
    const res = await confirmPost(ctx);
    expect(res.status).toBe(404);
  });

  it('409 gdy helper zwraca duplicate z shelfHint', async () => {
    mockConfirmDetectionToCatalog.mockResolvedValue({ ok: false, reason: 'duplicate', shelfHint: 'Salon' });
    const ctx = makeContext({});
    const res = await confirmPost(ctx);
    expect(res.status).toBe(409);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('CONFLICT');
    expect(json.error!.message).toContain('Salon');
  });

  it('409 gdy helper zwraca already_confirmed (guard idempotencji)', async () => {
    mockConfirmDetectionToCatalog.mockResolvedValue({ ok: false, reason: 'already_confirmed' });
    const ctx = makeContext({});
    const res = await confirmPost(ctx);
    expect(res.status).toBe(409);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('CONFLICT');
  });

  it('200 z book_id i shelf_id przy sukcesie', async () => {
    const ctx = makeContext({});
    const res = await confirmPost(ctx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!.book_id).toBe(BOOK_ID);
    expect(json.data!.shelf_id).toBe(SHELF_ID);
  });

  it('woła helper z correctionType accept', async () => {
    const ctx = makeContext({});
    await confirmPost(ctx);
    expect(mockConfirmDetectionToCatalog).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({ correctionType: 'accept' })
    );
  });

  it('Cache-Control: private, no-store w odpowiedzi', async () => {
    const ctx = makeContext({});
    const res = await confirmPost(ctx);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });
});

// ===========================================================================
// REJECT endpoint
// ===========================================================================

describe('POST /api/detections/[id]/reject', () => {
  it('401 gdy brak użytkownika', async () => {
    const ctx = makeContext({ user: false });
    const res = await rejectPost(ctx);
    expect(res.status).toBe(401);
  });

  it('404 gdy id nie jest UUID', async () => {
    const ctx = makeContext({ id: 'not-a-uuid' });
    const res = await rejectPost(ctx);
    expect(res.status).toBe(404);
  });

  it('404 gdy detekcja nie istnieje', async () => {
    const ctx = makeContext({ detResult: { data: null, error: null } });
    const res = await rejectPost(ctx);
    expect(res.status).toBe(404);
  });

  it('200 z rejected: true', async () => {
    const ctx = makeContext({});
    const res = await rejectPost(ctx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!.rejected).toBe(true);
  });

  it('Cache-Control header obecny', async () => {
    const ctx = makeContext({});
    const res = await rejectPost(ctx);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });
});

// ===========================================================================
// UNREJECT endpoint
// ===========================================================================

function makeUnrejectContext(opts: {
  id?: string;
  user?: boolean;
  detResult?: { data: { id: string; status: string } | null; error: PgError };
  candCount?: number;
  updateError?: PgError;
}) {
  const detResult = opts.detResult ?? { data: { id: DET_ID, status: 'rejected' }, error: null };
  const candCount = opts.candCount ?? 0;
  const deleteEqInner = vi.fn().mockResolvedValue({ error: null });

  const fromMock = vi.fn((table: string) => {
    if (table === 'detections') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue(detResult),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: opts.updateError ?? null }),
        })),
      };
    }
    if (table === 'book_candidates') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ count: candCount, error: null }),
        })),
      };
    }
    if (table === 'corrections') {
      return {
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({ eq: deleteEqInner })),
        })),
      };
    }
    return {};
  });

  return {
    params: { id: opts.id ?? DET_ID },
    locals: {
      user: opts.user !== false ? { id: USER_ID, email: 'test@example.com' } : null,
      supabase: { from: fromMock } as never,
    },
  } as never;
}

describe('POST /api/detections/[id]/unreject', () => {
  it('401 gdy brak użytkownika', async () => {
    const res = await unrejectPost(makeUnrejectContext({ user: false }));
    expect(res.status).toBe(401);
  });

  it('404 gdy id nie jest UUID', async () => {
    const res = await unrejectPost(makeUnrejectContext({ id: 'not-a-uuid' }));
    expect(res.status).toBe(404);
  });

  it('404 gdy detekcja nie istnieje', async () => {
    const res = await unrejectPost(makeUnrejectContext({ detResult: { data: null, error: null } }));
    expect(res.status).toBe(404);
  });

  it('200 status=matched gdy detekcja ma kandydatów', async () => {
    const res = await unrejectPost(makeUnrejectContext({ candCount: 3 }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!.status).toBe('matched');
  });

  it('200 status=pending gdy brak kandydatów', async () => {
    const res = await unrejectPost(makeUnrejectContext({ candCount: 0 }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!.status).toBe('pending');
  });

  it('500 gdy update DB pada', async () => {
    const res = await unrejectPost(
      makeUnrejectContext({ updateError: { name: 'PostgrestError', message: 'boom' } })
    );
    expect(res.status).toBe(500);
  });

  it('Cache-Control header obecny', async () => {
    const res = await unrejectPost(makeUnrejectContext({}));
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });
});

// ===========================================================================
// CORRECT endpoint
// ===========================================================================

describe('POST /api/detections/[id]/correct', () => {
  it('401 gdy brak użytkownika', async () => {
    const ctx = makeContext({ user: false, body: { mode: 'field_edit', candidate_id: CAND_ID, title: 'T' } });
    const res = await correctPost(ctx);
    expect(res.status).toBe(401);
  });

  it('400 gdy brakuje mode w body', async () => {
    const ctx = makeContext({ body: { candidate_id: CAND_ID, title: 'T' } });
    const res = await correctPost(ctx);
    expect(res.status).toBe(400);
  });

  it('400 gdy field_edit bez candidate_id', async () => {
    const ctx = makeContext({ body: { mode: 'field_edit', title: 'T' } });
    const res = await correctPost(ctx);
    expect(res.status).toBe(400);
  });

  it('400 gdy manual_entry bez title', async () => {
    const ctx = makeContext({ body: { mode: 'manual_entry' } });
    const res = await correctPost(ctx);
    expect(res.status).toBe(400);
  });

  it('200 przy field_edit — woła helper z field_edit', async () => {
    const ctx = makeContext({
      body: { mode: 'field_edit', candidate_id: CAND_ID, title: 'Poprawiony tytuł' },
    });
    const res = await correctPost(ctx);
    expect(res.status).toBe(200);
    expect(mockConfirmDetectionToCatalog).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({ correctionType: 'field_edit' })
    );
  });

  it('200 przy manual_entry — source=manual, woła helper z manual_entry', async () => {
    const ctx = makeContext({
      body: { mode: 'manual_entry', title: 'Ręczna książka' },
    });
    const res = await correctPost(ctx);
    expect(res.status).toBe(200);
    expect(mockConfirmDetectionToCatalog).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({
        correctionType: 'manual_entry',
        book: expect.objectContaining({ source: 'manual' }),
      })
    );
  });

  it('409 przy duplicate', async () => {
    mockConfirmDetectionToCatalog.mockResolvedValue({ ok: false, reason: 'duplicate' });
    const ctx = makeContext({
      body: { mode: 'field_edit', candidate_id: CAND_ID, title: 'T' },
    });
    const res = await correctPost(ctx);
    expect(res.status).toBe(409);
  });

  it('404 gdy kandydat nie należy do detekcji (field_edit)', async () => {
    const ctx = makeContext({
      body: { mode: 'field_edit', candidate_id: CAND_ID, title: 'T' },
      candResult: { data: null, error: null },
    });
    const res = await correctPost(ctx);
    expect(res.status).toBe(404);
  });
});
