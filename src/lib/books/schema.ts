import { z } from 'zod';

// ---------------------------------------------------------------------------
// Typy wewnętrzne (matching engine, S-04)
// ---------------------------------------------------------------------------

export type BookCandidate = {
  source: 'google_books' | 'open_library';
  externalId: string;
  title: string;
  authors: string[];
  isbn10: string | null;
  isbn13: string | null;
  publisher: string | null;
  publishedYear: number | null;
  coverUrl: string | null;
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

export type ShelfBookDTO = {
  id: string;
  title: string;
  authors: string[];
  cover_url: string | null;
  published_year: number | null;
  position_index: number | null;
  is_read: boolean;
};

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
  authors: z.array(z.string().min(1).max(200)).min(1, 'Podaj co najmniej jednego autora').optional(),
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
    isbn_13: z.string().regex(/^\d{13}$/).optional(),
    isbn_10: z.string().regex(/^\d{9}[\dX]$/).optional(),
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
      })
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
    isbn_13: z.string().regex(/^\d{13}$/).optional(),
    isbn_10: z.string().regex(/^\d{9}[\dX]$/).optional(),
    purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data w formacie YYYY-MM-DD').optional(),
  })
  .strict();
export type AddPurchaseInput = z.infer<typeof AddPurchaseSchema>;
