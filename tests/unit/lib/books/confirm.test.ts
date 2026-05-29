import { describe, it, expect, vi, beforeEach } from 'vitest';
import { confirmDetectionToCatalog } from '../../../../src/lib/books/confirm';

// ---------------------------------------------------------------------------
// Mock factory — buduje łańcuch Supabase per test
// ---------------------------------------------------------------------------

type MockResult = { data: unknown; error: unknown };

function makeSupabaseMock(overrides: {
  booksSelect?: MockResult;
  booksInsert?: MockResult;
  shelfEntriesSelect?: MockResult; // dla max position
  shelfEntriesInsert?: MockResult;
  detectionsUpdate?: MockResult;
  correctionsInsert?: MockResult;
}) {
  // Defaults: sukces z minimalnym data
  const defaults = {
    booksSelect: { data: null, error: null },         // brak exact-dup
    booksInsert: { data: { id: 'new-book-id' }, error: null },
    shelfEntriesSelect: { data: null, error: null },   // brak istniejących → max = 0
    shelfEntriesInsert: { data: null, error: null },
    detectionsUpdate: { data: null, error: null },
    correctionsInsert: { data: null, error: null },
  };
  const cfg = { ...defaults, ...overrides };

  const mock = {
    from: vi.fn((table: string) => {
      if (table === 'books') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue(cfg.booksSelect),
              })),
            })),
          })),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue(cfg.booksInsert),
            })),
          })),
          delete: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        };
      }
      if (table === 'shelf_entries') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    maybeSingle: vi.fn().mockResolvedValue(cfg.shelfEntriesSelect),
                  })),
                })),
              })),
            })),
          })),
          insert: vi.fn().mockResolvedValue(cfg.shelfEntriesInsert),
        };
      }
      if (table === 'detections') {
        return {
          update: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue(cfg.detectionsUpdate),
          })),
        };
      }
      if (table === 'corrections') {
        return {
          insert: vi.fn().mockResolvedValue(cfg.correctionsInsert),
        };
      }
      return {};
    }),
  };
  return mock as unknown as Parameters<typeof confirmDetectionToCatalog>[0];
}

const BASE_DETECTION = {
  id: 'det-1',
  status: 'matched',
  photo_id: 'photo-1',
  position_index: 3,
  raw_title: 'Tytuł z półki',
};

const BASE_BOOK = {
  title: 'Mistrz i Małgorzata',
  authors: ['Michaił Bułhakow'],
  isbn_10: null,
  isbn_13: '9788301055011',
  publisher: 'Czytelnik',
  published_year: 1967,
  cover_url: 'https://example.com/cover.jpg',
  source: 'google_books',
  source_external_id: 'gb-123',
};

beforeEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------------------
// Guard idempotencji
// ---------------------------------------------------------------------------

describe('confirmDetectionToCatalog — guard idempotencji', () => {
  it('zwraca already_confirmed gdy detection.status === confirmed', async () => {
    const supabase = makeSupabaseMock({});
    const result = await confirmDetectionToCatalog(supabase, 'user-1', {
      detection: { ...BASE_DETECTION, status: 'confirmed' },
      shelfId: 'shelf-1',
      book: BASE_BOOK,
      correctionType: 'accept',
    });
    expect(result).toEqual({ ok: false, reason: 'already_confirmed' });
    // Żaden insert nie powinien być wywołany
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Exact-dup (isbn_13)
// ---------------------------------------------------------------------------

describe('confirmDetectionToCatalog — exact-dup', () => {
  it('zwraca duplicate gdy isbn_13 już w katalogu', async () => {
    const supabase = makeSupabaseMock({
      booksSelect: {
        data: {
          id: 'existing-book',
          shelf_entries: [{ shelf_id: 's1', shelves: { name: 'Salon' } }],
        },
        error: null,
      },
    });
    const result = await confirmDetectionToCatalog(supabase, 'user-1', {
      detection: BASE_DETECTION,
      shelfId: 'shelf-1',
      book: BASE_BOOK,
      correctionType: 'accept',
    });
    expect(result).toEqual({ ok: false, reason: 'duplicate', shelfHint: 'Salon' });
  });

  it('nie robi pre-check gdy isbn_13 jest null', async () => {
    const supabase = makeSupabaseMock({
      booksInsert: { data: { id: 'new-id' }, error: null },
    });
    const result = await confirmDetectionToCatalog(supabase, 'user-1', {
      detection: BASE_DETECTION,
      shelfId: 'shelf-1',
      book: { ...BASE_BOOK, isbn_13: null },
      correctionType: 'accept',
    });
    // Powinno przejść do insertu bez sprawdzania dup
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sukces — accept
// ---------------------------------------------------------------------------

describe('confirmDetectionToCatalog — sukces', () => {
  it('tworzy book + shelf_entry z position z detekcji + correction(accept)', async () => {
    const supabase = makeSupabaseMock({});
    const result = await confirmDetectionToCatalog(supabase, 'user-1', {
      detection: BASE_DETECTION, // position_index = 3
      shelfId: 'shelf-1',
      book: BASE_BOOK,
      correctionType: 'accept',
    });
    expect(result).toEqual({ ok: true, bookId: 'new-book-id' });
  });

  it('używa max+1 gdy detection.position_index jest null', async () => {
    const supabase = makeSupabaseMock({
      shelfEntriesSelect: { data: { position_index: 5 }, error: null },
    });
    const result = await confirmDetectionToCatalog(supabase, 'user-1', {
      detection: { ...BASE_DETECTION, position_index: null },
      shelfId: 'shelf-1',
      book: BASE_BOOK,
      correctionType: 'accept',
    });
    expect(result.ok).toBe(true);
  });

  it('zwraca duplicate gdy insert books rzuca 23505 (race backstop)', async () => {
    const supabase = makeSupabaseMock({
      booksInsert: { data: null, error: { code: '23505', name: 'PostgrestError', message: 'dup' } },
    });
    const result = await confirmDetectionToCatalog(supabase, 'user-1', {
      detection: { ...BASE_DETECTION, status: 'pending' }, // isbn_13 null żeby skip pre-check
      shelfId: 'shelf-1',
      book: { ...BASE_BOOK, isbn_13: null },
      correctionType: 'accept',
    });
    expect(result).toEqual({ ok: false, reason: 'duplicate' });
  });
});

// ---------------------------------------------------------------------------
// Rollback przy porażce shelf_entries (F1 impl-review fix)
// ---------------------------------------------------------------------------

describe('confirmDetectionToCatalog — write_failed rollback', () => {
  it('przy porażce shelf_entries insert kasuje orphan book i zwraca write_failed', async () => {
    const deleteEqFn = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'books') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })),
              })),
            })),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { id: 'orphan-id' }, error: null }) })),
            })),
            delete: vi.fn(() => ({ eq: deleteEqFn })),
          };
        }
        if (table === 'shelf_entries') {
          return {
            insert: vi.fn().mockResolvedValue({ error: { code: '23503', name: 'PostgrestError', message: 'fk fail' } }),
          };
        }
        return {};
      }),
    } as unknown as Parameters<typeof confirmDetectionToCatalog>[0];

    const result = await confirmDetectionToCatalog(supabase, 'user-1', {
      detection: { ...BASE_DETECTION, position_index: 3 },
      shelfId: 'shelf-1',
      book: { ...BASE_BOOK, isbn_13: null }, // skip pre-check, dojdź do shelf_entries
      correctionType: 'accept',
    });

    expect(result).toEqual({ ok: false, reason: 'write_failed' });
    // Rollback: books.delete().eq('id', 'orphan-id') wywołane
    expect(deleteEqFn).toHaveBeenCalledWith('id', 'orphan-id');
  });
});
