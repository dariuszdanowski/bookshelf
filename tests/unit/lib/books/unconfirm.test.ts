import { describe, it, expect, vi, beforeEach } from 'vitest';
import { unconfirmDetectionFromCatalog } from '../../../../src/lib/books/confirm';

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

type MockResult = { data: unknown; error: unknown; count?: number | null };

function makeSupabaseMock(overrides: {
  detectionsSelect?: MockResult;
  shelfEntriesSelect?: MockResult; // zbieranie book_ids
  shelfEntriesDelete?: MockResult;
  shelfEntriesCount?: MockResult; // orphan-check per book_id
  booksDelete?: MockResult;
  bookCandidatesCount?: MockResult;
  detectionsUpdate?: MockResult;
  correctionsDelete?: MockResult;
}) {
  const defaults = {
    detectionsSelect: { data: { id: 'det-1', status: 'confirmed' }, error: null },
    shelfEntriesSelect: { data: [{ book_id: 'book-1' }], error: null },
    shelfEntriesDelete: { data: null, error: null },
    shelfEntriesCount: { data: null, error: null, count: 0 }, // orphan → kasuj
    booksDelete: { data: null, error: null },
    bookCandidatesCount: { data: null, error: null, count: 2 }, // → matched
    detectionsUpdate: { data: null, error: null },
    correctionsDelete: { data: null, error: null },
  };
  const cfg = { ...defaults, ...overrides };

  const mock = {
    from: vi.fn((table: string) => {
      if (table === 'detections') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue(cfg.detectionsSelect),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue(cfg.detectionsUpdate),
          })),
        };
      }
      if (table === 'shelf_entries') {
        return {
          select: vi.fn((_fields: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.count === 'exact') {
              // orphan-check: count remaining entries for book
              return {
                eq: vi.fn().mockResolvedValue(cfg.shelfEntriesCount),
              };
            }
            // collecting book_ids
            return {
              eq: vi.fn().mockResolvedValue(cfg.shelfEntriesSelect),
            };
          }),
          delete: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue(cfg.shelfEntriesDelete),
          })),
        };
      }
      if (table === 'books') {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue(cfg.booksDelete),
          })),
        };
      }
      if (table === 'book_candidates') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue(cfg.bookCandidatesCount),
          })),
        };
      }
      if (table === 'corrections') {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn().mockResolvedValue(cfg.correctionsDelete),
            })),
          })),
        };
      }
      return {};
    }),
  };
  return mock as unknown as Parameters<typeof unconfirmDetectionFromCatalog>[0];
}

beforeEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------------------
// Guard: not_found
// ---------------------------------------------------------------------------

describe('unconfirmDetectionFromCatalog — not_found', () => {
  it('zwraca not_found gdy detection nie istnieje (RLS scope lub brak)', async () => {
    const supabase = makeSupabaseMock({
      detectionsSelect: { data: null, error: null },
    });
    const result = await unconfirmDetectionFromCatalog(supabase, 'user-1', 'det-99');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
    // Żaden insert/delete nie powinien być wywołany
    const fromCalls = (supabase.from as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const detectionsCalls = fromCalls.filter((args) => args[0] === 'detections');
    expect(detectionsCalls).toHaveLength(1); // tylko SELECT
  });
});

// ---------------------------------------------------------------------------
// Guard: not_confirmed
// ---------------------------------------------------------------------------

describe('unconfirmDetectionFromCatalog — not_confirmed', () => {
  it.each(['pending', 'matched', 'rejected'])(
    'zwraca not_confirmed gdy status=%s',
    async (status) => {
      const supabase = makeSupabaseMock({
        detectionsSelect: { data: { id: 'det-1', status }, error: null },
      });
      const result = await unconfirmDetectionFromCatalog(supabase, 'user-1', 'det-1');
      expect(result).toEqual({ ok: false, reason: 'not_confirmed' });
    },
  );
});

// ---------------------------------------------------------------------------
// Happy-path: entry+book usunięte, status reset, korekty skasowane
// ---------------------------------------------------------------------------

describe('unconfirmDetectionFromCatalog — happy-path', () => {
  it('usuwa shelf_entry + orphan book, reset status matched, kasuje korekty', async () => {
    const supabase = makeSupabaseMock({});
    const result = await unconfirmDetectionFromCatalog(supabase, 'user-1', 'det-1');
    expect(result).toEqual({ ok: true, status: 'matched' });
  });

  it('zwraca status pending gdy brak kandydatów (count=0)', async () => {
    const supabase = makeSupabaseMock({
      bookCandidatesCount: { data: null, error: null, count: 0 },
    });
    const result = await unconfirmDetectionFromCatalog(supabase, 'user-1', 'det-1');
    expect(result).toEqual({ ok: true, status: 'pending' });
  });
});

// ---------------------------------------------------------------------------
// Orphan-safety: książka z innym shelf_entry NIE jest kasowana
// ---------------------------------------------------------------------------

describe('unconfirmDetectionFromCatalog — orphan-safety', () => {
  it('nie kasuje books gdy pozostałe shelf_entries wskazują na tę książkę', async () => {
    const booksDeleteEqFn = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'detections') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue({ data: { id: 'det-1', status: 'confirmed' }, error: null }),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
          };
        }
        if (table === 'shelf_entries') {
          return {
            select: vi.fn((_fields: string, opts?: { count?: string }) => {
              if (opts?.count === 'exact') {
                // count > 0 → NIE kasuj
                return { eq: vi.fn().mockResolvedValue({ data: null, error: null, count: 1 }) };
              }
              return {
                eq: vi.fn().mockResolvedValue({ data: [{ book_id: 'book-shared' }], error: null }),
              };
            }),
            delete: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
          };
        }
        if (table === 'books') {
          return {
            delete: vi.fn(() => ({ eq: booksDeleteEqFn })),
          };
        }
        if (table === 'book_candidates') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ data: null, error: null, count: 1 }),
            })),
          };
        }
        if (table === 'corrections') {
          return {
            delete: vi.fn(() => ({
              eq: vi.fn(() => ({ in: vi.fn().mockResolvedValue({ data: null, error: null }) })),
            })),
          };
        }
        return {};
      }),
    } as unknown as Parameters<typeof unconfirmDetectionFromCatalog>[0];

    const result = await unconfirmDetectionFromCatalog(supabase, 'user-1', 'det-1');
    expect(result.ok).toBe(true);
    // books.delete().eq nigdy nie wywołane (count=1 → nie kasuj)
    expect(booksDeleteEqFn).not.toHaveBeenCalled();
  });
});
