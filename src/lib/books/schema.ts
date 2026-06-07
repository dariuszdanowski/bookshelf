import { z } from 'zod';
import { SPINE_COLORS } from '../vision/prompt';

// ---------------------------------------------------------------------------
// Typy wewnętrzne (matching engine, S-04)
// ---------------------------------------------------------------------------

export type BookCandidate = {
  source: 'google_books' | 'open_library' | 'national_library';
  externalId: string;
  title: string;
  authors: string[];
  isbn10: string | null;
  isbn13: string | null;
  publisher: string | null;
  publishedYear: number | null;
  coverUrl: string | null;
  /** Krótki opis z publicznej bazy (S-17, FR-032) — tylko Google Books; OL (drugi
   *  request per kandydat) i BN (brak danych w źródle) świadomie zwracają null.
   *  Pole wymagane w typie (nullable w wartości) — wymusza świadomą decyzję
   *  w każdym mapperze źródła. */
  description: string | null;
};

export type ScoredCandidate = BookCandidate & { matchScore: number };

export type BookSearchResult =
  | { ok: true; candidates: BookCandidate[] }
  | { ok: false; reason: 'rate_limited' | 'network' | 'empty' };

// ---------------------------------------------------------------------------
// DTO dla API (strona review, S-04)
// ---------------------------------------------------------------------------

export const BookCandidateDTOSchema = z.object({
  id: z.string(),
  source: z.string(),
  externalId: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  isbn10: z.string().nullable(),
  isbn13: z.string().nullable(),
  publisher: z.string().nullable(),
  publishedYear: z.number().nullable(),
  coverUrl: z.string().nullable(),
  matchScore: z.number(),
  rank: z.number(),
});

export type BookCandidateDTO = z.infer<typeof BookCandidateDTOSchema>;

// ---------------------------------------------------------------------------
// DTO dla widoku półki (S-05)
// ---------------------------------------------------------------------------

// Który slot okładki pokazać (S-33): automatyczna / wklejony URL / wgrane zdjęcie.
export type CoverSource = 'auto' | 'url' | 'photo';

// Zmiana okładki propagowana z modala do listy (optimistic update w islandzie).
export type BookCoverPatch = Partial<{
  cover_url: string | null;
  user_cover_url: string | null;
  cover_photo_url: string | null;
  cover_source: CoverSource;
}>;

export type ShelfBookDTO = {
  id: string;
  title: string;
  authors: string[];
  cover_url: string | null;
  published_year: number | null;
  position_index: number | null;
  is_read: boolean;
  photo_id: string | null;
  // Detekcja źródłowa z aktywnego shelf_entry (S-37) — deep-link do review z fokusem.
  // NULL dla wpisów ręcznych i po skasowaniu detekcji (FK ON DELETE SET NULL).
  detection_id: string | null;
  // Pola do podglądu szczegółów książki (S-33). Nullable — starsze wpisy lub
  // ręczne dodania mogą ich nie mieć.
  isbn_13: string | null;
  isbn_10: string | null;
  publisher: string | null;
  // Override okładki (S-33): 3 sloty mogą współistnieć; cover_source wybiera który.
  user_cover_url: string | null;
  cover_photo_url: string | null;
  cover_source: CoverSource;
};

// DTO dla wyników wyszukiwarki katalogu (S-08) — ShelfBookDTO + nazwa półki + kolor
export type CatalogBookDTO = ShelfBookDTO & {
  shelf_id: string;
  shelf_name: string;
  spine_color: string | null;
};

// GET /api/books/search — parametry zapytania (wszystkie opcjonalne, kombinowalne)
export const SearchBooksQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  color: z.enum(SPINE_COLORS).optional(),
  shelf_ids: z.array(z.uuid()).optional(),
  read: z.enum(['read', 'unread', 'all']).optional(),
});
export type SearchBooksQuery = z.infer<typeof SearchBooksQuerySchema>;

// ---------------------------------------------------------------------------
// Schematy decyzji katalogowych (S-05)
// ---------------------------------------------------------------------------

// POST /api/detections/[id]/confirm — akceptacja wskazanego kandydata
export const ConfirmDetectionSchema = z.object({
  candidate_id: z.uuid(),
});
export type ConfirmDetectionInput = z.infer<typeof ConfirmDetectionSchema>;

// POST /api/detections/[id]/correct — edycja pól lub wpis ręczny (brak candidate)
const CorrectedFieldsShape = {
  title: z.string().min(1, 'Tytuł nie może być pusty').max(300),
  authors: z
    .array(z.string().min(1).max(200))
    .min(1, 'Podaj co najmniej jednego autora')
    .optional(),
  publisher: z.string().max(200).optional(),
  published_year: z
    .number()
    .int()
    .min(1000, 'Rok musi być po 1000')
    .max(2100, 'Rok musi być przed 2100')
    .optional(),
};

export const CorrectDetectionSchema = z.discriminatedUnion('mode', [
  // Wariant A: edycja pól przy istniejącym kandydacie (telemetria: field_edit)
  z.object({
    mode: z.literal('field_edit'),
    candidate_id: z.uuid(),
    ...CorrectedFieldsShape,
  }),
  // Wariant B: ręczny wpis bez kandydata — brak matchu (telemetria: manual_entry)
  z.object({
    mode: z.literal('manual_entry'),
    candidate_id: z.undefined().optional(),
    ...CorrectedFieldsShape,
    isbn_13: z
      .string()
      .regex(/^\d{13}$/)
      .optional(),
    isbn_10: z
      .string()
      .regex(/^\d{9}[\dX]$/)
      .optional(),
  }),
]);
export type CorrectDetectionInput = z.infer<typeof CorrectDetectionSchema>;

// POST /api/photos/[id]/confirm-batch — hurtowa akceptacja pre-zaznaczonych
export const ConfirmBatchSchema = z.object({
  items: z
    .array(
      z.object({
        detection_id: z.uuid(),
        candidate_id: z.uuid(),
      }),
    )
    .min(1, 'Lista items nie może być pusta'),
});
export type ConfirmBatchInput = z.infer<typeof ConfirmBatchSchema>;

// PATCH /api/books/[id] — toggle statusu przeczytania
export const UpdateBookReadSchema = z
  .object({
    is_read: z.boolean(),
  })
  .strict(); // odrzuca dodatkowe pola (inne pola books nie są edytowalne przez ten endpoint)
export type UpdateBookReadInput = z.infer<typeof UpdateBookReadSchema>;

// PATCH /api/books/[id] — pełny update edytowalnych pól (S-33): is_read, override
// okładki ORAZ ręczna edycja metadanych (user jest ostateczną instancją — automaty
// to tylko propozycje). Każde pole opcjonalne; `null` = wyczyść; wymaga ≥1 pola.
// search_text jest GENERATED z (title, authors, publisher, description) → auto-aktualizacja.
export const UpdateBookSchema = z
  .object({
    is_read: z.boolean().optional(),
    // unify-book-save: cover_url (slot „auto") edytowalny przez ujednolicony zapis —
    // „Sprawdź okładkę automatycznie" ustawia go w stanie, główny „Zapisz" persystuje.
    cover_url: z.string().url('Nieprawidłowy URL').max(1000).nullable().optional(),
    user_cover_url: z.string().url('Nieprawidłowy URL').max(1000).nullable().optional(),
    cover_photo_url: z.string().url('Nieprawidłowy URL').max(1000).nullable().optional(),
    cover_source: z.enum(['auto', 'url', 'photo']).optional(),
    title: z.string().min(1, 'Tytuł nie może być pusty').max(300).optional(),
    authors: z.array(z.string().min(1).max(200)).optional(),
    publisher: z.string().max(300).nullable().optional(),
    published_year: z
      .number()
      .int()
      .min(1000, 'Rok po 1000')
      .max(2100, 'Rok przed 2100')
      .nullable()
      .optional(),
    isbn_13: z
      .string()
      .regex(/^\d{13}$/, 'ISBN-13 = 13 cyfr')
      .nullable()
      .optional(),
    isbn_10: z
      .string()
      .regex(/^\d{9}[\dX]$/, 'ISBN-10 = 10 znaków')
      .nullable()
      .optional(),
    // S-17: opis z wybranego kandydata (BookModal edit = ręczny per-book backfill
    // starych książek); bez kontrolki UI — payload dołącza go tylko z kandydata.
    description: z.string().max(2000).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Podaj co najmniej jedno pole.' });
export type UpdateBookInput = z.infer<typeof UpdateBookSchema>;

// POST /api/books/[id]/move — przeniesienie książki na inną półkę (S-07).
// Zapisuje wersjonowaną historię lokalizacji (FR-038); shelf_id z klienta walidowany RLS (oba-FK, 0009).
export const MoveBookSchema = z
  .object({
    shelf_id: z.uuid(),
  })
  .strict();
export type MoveBookInput = z.infer<typeof MoveBookSchema>;

// POST /api/books/[id]/identify — „Szukaj po tytule" dla zatwierdzonej książki
// (re-identyfikacja). Tryb 'search' zwraca kandydatów; 'apply' zapisuje wybranego.
const IdentifyCandidateShape = z.object({
  title: z.string().min(1).max(300),
  authors: z.array(z.string().max(200)).default([]),
  isbn13: z.string().max(20).nullable().optional(),
  isbn10: z.string().max(20).nullable().optional(),
  publisher: z.string().max(300).nullable().optional(),
  publishedYear: z.number().int().min(1000).max(2100).nullable().optional(),
  coverUrl: z.string().url().max(1000).nullable().optional(),
  source: z.string().max(50).nullable().optional(),
  externalId: z.string().max(200).nullable().optional(),
  // S-17: opis z kandydata (GB) — propagowany do books.description → search_text.
  description: z.string().max(2000).nullable().optional(),
});
export const IdentifyBookSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('search'),
    title: z.string().min(1, 'Tytuł nie może być pusty').max(300),
    author: z.string().max(200).nullable().optional(),
    isbn: z.string().max(20).nullable().optional(),
  }),
  z.object({
    mode: z.literal('apply'),
    candidate: IdentifyCandidateShape,
  }),
]);
export type IdentifyBookInput = z.infer<typeof IdentifyBookSchema>;

// POST /api/detections/[id]/rematch — wyszukanie Google Books z poprawionym tytułem/autorem
export const RematchDetectionSchema = z.object({
  title: z.string().min(1, 'Tytuł nie może być pusty').max(300),
  author: z.string().max(200).nullable().optional(),
  isbn: z.string().max(20).nullable().optional(),
  // M22: wydawnictwo z grzbietu — zawęża wyszukiwanie GB (inpublisher:)
  publisher: z.string().max(200).nullable().optional(),
});
export type RematchDetectionInput = z.infer<typeof RematchDetectionSchema>;

// POST /api/books/candidates — bezksiążkowe wyszukiwanie kandydatów (S-36).
// Co najmniej tytuł lub ISBN wymagany. Nie zapisuje nic do DB — read-only.
export const SearchCandidatesSchema = z
  .object({
    title: z.string().trim().max(300).optional(),
    author: z.string().trim().max(200).optional(),
    isbn: z.string().trim().max(20).optional(),
  })
  .strict()
  .refine((v) => !!(v.title || v.isbn), {
    message: 'Podaj tytuł lub ISBN.',
  });
export type SearchCandidatesInput = z.infer<typeof SearchCandidatesSchema>;

// POST /api/books — ręczny zakup (Flow B, S-06). Książka ląduje na „Zakupione".
// title wymagany; reszta opcjonalna; purchase_date pominięte → endpoint ustawia dziś.
export const AddPurchaseSchema = z
  .object({
    title: z.string().min(1, 'Tytuł nie może być pusty').max(300),
    authors: z.array(z.string().min(1).max(200)).optional(),
    publisher: z.string().max(200).optional(),
    published_year: z
      .number()
      .int()
      .min(1000, 'Rok musi być po 1000')
      .max(2100, 'Rok musi być przed 2100')
      .optional(),
    isbn_13: z
      .string()
      .regex(/^\d{13}$/)
      .optional(),
    isbn_10: z
      .string()
      .regex(/^\d{9}[\dX]$/)
      .optional(),
    purchase_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data w formacie YYYY-MM-DD')
      .optional(),
    // S-33: dodanie ręczne na DOWOLNĄ półkę (bez zdjęcia). Brak → „Zakupione" (Flow B).
    shelf_id: z.uuid().optional(),
    cover_url: z.string().url().max(1000).optional(),
    // unify-add-cover: parzystość z edytorem okładki — 3 sloty + flaga źródła
    // zapisywane od razu przy tworzeniu (jak w PATCH/UpdateBookSchema).
    user_cover_url: z.string().url().max(1000).optional(),
    cover_photo_url: z.string().url().max(1000).optional(),
    cover_source: z.enum(['auto', 'url', 'photo']).optional(),
    // S-17: opis z wybranego kandydata (BookModal add) → books.description → search_text.
    description: z.string().max(2000).nullable().optional(),
  })
  .strict();
export type AddPurchaseInput = z.infer<typeof AddPurchaseSchema>;
