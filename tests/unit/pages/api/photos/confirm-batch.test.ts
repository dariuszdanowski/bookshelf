import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConfirmDetectionToCatalog = vi.hoisted(() => vi.fn());

vi.mock('../../../../../src/lib/books/confirm', () => ({
  confirmDetectionToCatalog: mockConfirmDetectionToCatalog,
}));

import { POST } from '../../../../../src/pages/api/photos/[id]/confirm-batch';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const PHOTO_ID = '00000000-0000-4000-8000-000000000003';
const SHELF_ID = '00000000-0000-4000-8000-000000000040';
const DET_ID_1 = '00000000-0000-4000-8000-000000000010';
const DET_ID_2 = '00000000-0000-4000-8000-000000000011';
const CAND_ID_1 = '00000000-0000-4000-8000-000000000020';
const CAND_ID_2 = '00000000-0000-4000-8000-000000000021';
const BOOK_ID_1 = '00000000-0000-4000-8000-000000000050';
const BOOK_ID_2 = '00000000-0000-4000-8000-000000000051';

const photoRow = { id: PHOTO_ID, shelf_id: SHELF_ID };

const det1 = {
  id: DET_ID_1, status: 'matched', photo_id: PHOTO_ID, position_index: 1, raw_title: 'Lem',
};
const det2 = {
  id: DET_ID_2, status: 'matched', photo_id: PHOTO_ID, position_index: 2, raw_title: 'Herbert',
};

const cand1 = {
  id: CAND_ID_1, detection_id: DET_ID_1, source: 'google_books', external_id: 'gb-1',
  title: 'Solaris', authors: ['S. Lem'], isbn_10: null, isbn_13: '9780000000001',
  publisher: null, published_year: null, cover_url: null,
};
const cand2 = {
  id: CAND_ID_2, detection_id: DET_ID_2, source: 'google_books', external_id: 'gb-2',
  title: 'Diuna', authors: ['Frank Herbert'], isbn_10: null, isbn_13: '9780000000002',
  publisher: null, published_year: null, cover_url: null,
};

type PgError = { code?: string; name: string; message: string } | null;
type BatchJson = { data?: { confirmed: {detection_id:string; book_id:string}[]; skipped: {detection_id:string; reason:string}[] }; error?: { code: string; message: string } };

function makeContext(opts: {
  id?: string;
  body?: unknown;
  photoResult?: { data: typeof photoRow | null; error: PgError };
  detRows?: typeof det1[];
  detError?: PgError;
  candRows?: typeof cand1[];
  candError?: PgError;
  user?: boolean;
}) {
  const photoResult = opts.photoResult ?? { data: photoRow, error: null };

  const fromMock = vi.fn((table: string) => {
    if (table === 'photos') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue(photoResult),
          })),
        })),
      };
    }
    if (table === 'detections') {
      return {
        select: vi.fn(() => ({
          in: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: opts.detRows ?? [det1, det2],
              error: opts.detError ?? null,
            }),
          })),
        })),
      };
    }
    if (table === 'book_candidates') {
      return {
        select: vi.fn(() => ({
          in: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: opts.candRows ?? [cand1, cand2],
              error: opts.candError ?? null,
            }),
          })),
        })),
      };
    }
    return {};
  });

  return {
    params: { id: opts.id ?? PHOTO_ID },
    request: {
      json: vi.fn().mockResolvedValue(
        opts.body ?? {
          items: [
            { detection_id: DET_ID_1, candidate_id: CAND_ID_1 },
            { detection_id: DET_ID_2, candidate_id: CAND_ID_2 },
          ],
        }
      ),
    },
    locals: {
      user: opts.user !== false ? { id: USER_ID, email: 'test@example.com' } : null,
      supabase: { from: fromMock } as never,
    },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockConfirmDetectionToCatalog
    .mockResolvedValueOnce({ ok: true, bookId: BOOK_ID_1 })
    .mockResolvedValueOnce({ ok: true, bookId: BOOK_ID_2 });
});

describe('POST /api/photos/[id]/confirm-batch', () => {
  it('401 gdy brak użytkownika', async () => {
    const ctx = makeContext({ user: false });
    const res = await POST(ctx);
    expect(res.status).toBe(401);
  });

  it('404 gdy photo UUID nieprawidłowy', async () => {
    const ctx = makeContext({ id: 'not-a-uuid' });
    const res = await POST(ctx);
    expect(res.status).toBe(404);
  });

  it('404 gdy zdjęcie nie istnieje', async () => {
    const ctx = makeContext({ photoResult: { data: null, error: null } });
    const res = await POST(ctx);
    expect(res.status).toBe(404);
  });

  it('400 gdy items jest puste', async () => {
    const ctx = makeContext({ body: { items: [] } });
    const res = await POST(ctx);
    expect(res.status).toBe(400);
    const json = (await res.json()) as BatchJson;
    expect(json.error!.code).toBe('VALIDATION_ERROR');
  });

  it('400 gdy brak items w body', async () => {
    const ctx = makeContext({ body: {} });
    const res = await POST(ctx);
    expect(res.status).toBe(400);
  });

  it('200 z confirmed i skipped', async () => {
    const ctx = makeContext({});
    const res = await POST(ctx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as BatchJson;
    expect(json.data!.confirmed).toHaveLength(2);
    expect(json.data!.confirmed[0]).toMatchObject({ detection_id: DET_ID_1, book_id: BOOK_ID_1 });
    expect(json.data!.confirmed[1]).toMatchObject({ detection_id: DET_ID_2, book_id: BOOK_ID_2 });
    expect(json.data!.skipped).toHaveLength(0);
  });

  it('duplikat w środku -> skipped, reszta kontynuuje', async () => {
    mockConfirmDetectionToCatalog
      .mockReset()
      .mockResolvedValueOnce({ ok: false, reason: 'duplicate', shelfHint: 'Salon' })
      .mockResolvedValueOnce({ ok: true, bookId: BOOK_ID_2 });

    const ctx = makeContext({});
    const res = await POST(ctx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as BatchJson;
    expect(json.data!.confirmed).toHaveLength(1);
    expect(json.data!.skipped).toHaveLength(1);
    expect(json.data!.skipped[0].reason).toBe('duplicate');
  });

  it('detekcja nieznaleziona -> skipped (not_found)', async () => {
    // DET_ID_2 nieznaleziony — zwracamy tylko det1
    const ctx = makeContext({ detRows: [det1] });
    const res = await POST(ctx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as BatchJson;
    // DET_ID_2 → skipped (not_found), DET_ID_1 → confirmed
    const skippedItem = json.data!.skipped.find(
      (s: { detection_id: string }) => s.detection_id === DET_ID_2
    );
    expect(skippedItem?.reason).toBe('not_found');
  });

  it('Cache-Control: private, no-store', async () => {
    const ctx = makeContext({});
    const res = await POST(ctx);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
