import type { APIRoute } from 'astro';
import { z } from 'zod';

import { apiError, apiResponse, parseUuidParam } from '../../../../lib/http/response';
import { DeleteCandidateSchema, UpdateCandidateSchema } from '../../../../lib/books/schema';

export const prerender = false;

/**
 * external_id draftu — konwencja nazewnictwa jak `ai-resolution:${detectionId}`
 * w resolve.ts, ale bez wcześniejszego precedensu dla lifecycle "żywy draft-wiersz
 * tworzony na klik, sprzątany DELETE-em przy porzuceniu" (plan-review F4,
 * unify-detection-edit-entrypoint).
 */
function manualExternalId(detectionId: string): string {
  return `manual:${detectionId}`;
}

/**
 * PATCH /api/detections/[id]/candidate
 *
 * Nadpisuje dowolny podzbiór edytowalnych pól kandydata (book_candidates)
 * PRZED zatwierdzeniem detekcji do katalogu (candidate-propose-edit-all-fields,
 * następca candidate-cover-override, który obsługiwał tylko cover_url).
 * Zawsze ustawia edited_at = now() (sygnał "ktoś tu grzebał"). confirm.ts/
 * confirm-batch.ts czytają te kolumny świeżo przy zatwierdzeniu i wybierają
 * correction_type na podstawie edited_at.
 *
 * Body: { candidate_id: uuid, ...dowolny podzbiór pól }
 * 200: { data: { candidate_id, title, authors, isbn_13, isbn_10, publisher,
 *               published_year, cover_url, purchase_date, purchase_price,
 *               purchase_city, purchase_event } }
 * 404: detekcja / kandydat nie istnieje, cudzy, lub kandydat nie należy do tej detekcji
 * 400: walidacja Zod (zły URL, zły ISBN, brak pól)
 *
 * Adaptacja literalna vs plan (odziedziczona z cover.ts): pojedynczy update+select
 * (wzorzec bbox.ts) zamiast osobnego select-detekcji + update-kandydata — WHERE
 * (id = candidate_id AND detection_id = detectionId) już poprawnie 404-uje zarówno
 * nieistniejącą detekcję jak i kandydata spoza niej, bez dodatkowego zapytania.
 */
export const PATCH: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const detectionId = parseUuidParam(params.id);
  if (!detectionId) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono detekcji.' });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Nieprawidłowe ciało żądania.',
    });
  }

  const parsed = UpdateCandidateSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Nieprawidłowe dane.',
      details: z.flattenError(parsed.error),
    });
  }

  const { candidate_id, ...fields } = parsed.data;

  const { data: rows, error } = await locals.supabase
    .from('book_candidates')
    .update({ ...fields, edited_at: new Date().toISOString() })
    .eq('id', candidate_id)
    .eq('detection_id', detectionId)
    .select(
      'id, title, authors, isbn_13, isbn_10, publisher, published_year, cover_url, purchase_date, purchase_price, purchase_city, purchase_event',
    );

  if (error) {
    console.error('[api/detections candidate PATCH] update failed', {
      name: error.name,
      message: error.message,
      code: error.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd serwera.' });
  }

  if (!rows || rows.length === 0) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono kandydata.' });
  }

  const row = rows[0];
  return apiResponse({
    data: {
      candidate_id: row.id,
      title: row.title,
      authors: row.authors,
      isbn_13: row.isbn_13,
      isbn_10: row.isbn_10,
      publisher: row.publisher,
      published_year: row.published_year,
      cover_url: row.cover_url,
      purchase_date: row.purchase_date,
      purchase_price: row.purchase_price,
      purchase_city: row.purchase_city,
      purchase_event: row.purchase_event,
    },
  });
};

/**
 * POST /api/detections/[id]/candidate
 *
 * Tworzy minimalny draft-kandydat (`source: 'manual'`) dla detekcji bez matcha —
 * punkt wejścia dla placeholdera okładki w stanie no-match
 * (unify-detection-edit-entrypoint). Kształt odpowiedzi zgodny z `BookCandidateDTO`,
 * gotowy do `candidateToDetail()` bez zmian tej funkcji. title/authors seedowane
 * z detection.raw_title/raw_author — bez tego „Szukaj w sieci"/„Wyszukaj po
 * danych" w BookModal startowały bez autora mimo że OCR go poprawnie odczytał
 * (widoczny pod zdjęciem), zgłoszone przez usera podczas manualnego smoke testu.
 *
 * Body: puste — wszystko wyprowadzane server-side z `detectionId`.
 * 201: { data: { candidate_id, title, authors, isbn_13: null, isbn_10: null,
 *               publisher: null, published_year: null, cover_url: null } }
 * 404: detekcja nie istnieje / cudza
 * 409: detekcja ma już status != 'pending' (nie twórz draftu dla zdecydowanej detekcji)
 */
export const POST: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const detectionId = parseUuidParam(params.id);
  if (!detectionId) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono detekcji.' });
  }

  const { data: detection, error: detectionError } = await locals.supabase
    .from('detections')
    .select('id, status, raw_title, raw_author')
    .eq('id', detectionId)
    .maybeSingle();

  if (detectionError) {
    console.error('[api/detections candidate POST] detection select failed', {
      name: detectionError.name,
      message: detectionError.message,
      code: detectionError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd serwera.' });
  }

  if (!detection) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono detekcji.' });
  }

  if (detection.status !== 'pending') {
    return apiError({
      code: 'CONFLICT',
      status: 409,
      message: 'Detekcja została już zdecydowana.',
    });
  }

  const { data: rows, error: insertError } = await locals.supabase
    .from('book_candidates')
    .insert({
      detection_id: detectionId,
      source: 'manual',
      external_id: manualExternalId(detectionId),
      title: detection.raw_title ?? '',
      authors: detection.raw_author ? [detection.raw_author] : [],
      rank: 1,
    })
    .select('id, title, authors, isbn_13, isbn_10, publisher, published_year, cover_url');

  if (insertError || !rows || rows.length === 0) {
    console.error('[api/detections candidate POST] insert failed', {
      name: insertError?.name,
      message: insertError?.message,
      code: insertError?.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd tworzenia kandydata.' });
  }

  const row = rows[0];
  return apiResponse({
    status: 201,
    data: {
      candidate_id: row.id,
      title: row.title,
      authors: row.authors,
      isbn_13: row.isbn_13,
      isbn_10: row.isbn_10,
      publisher: row.publisher,
      published_year: row.published_year,
      cover_url: row.cover_url,
    },
  });
};

/**
 * DELETE /api/detections/[id]/candidate
 *
 * Usuwa dokładnie jeden, nigdy-nie-zapisany draft-kandydat — wywoływane z `onClose`
 * w `DetectionReview`, gdy user otworzył `BookModal` dla świeżo utworzonego draftu
 * i zamknął bez zapisu (unify-detection-edit-entrypoint).
 *
 * Body: { candidate_id: uuid }
 * 200: { data: { deleted: true } } niezależnie od tego czy wiersz istniał
 *      (idempotentne — modal mógł już zostać zamknięty przez inny event)
 *
 * Guard `source = 'manual' AND edited_at IS NULL` chroni przed przypadkowym
 * usunięciem realnego, edytowanego kandydata.
 */
export const DELETE: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const detectionId = parseUuidParam(params.id);
  if (!detectionId) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono detekcji.' });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Nieprawidłowe ciało żądania.',
    });
  }

  const parsed = DeleteCandidateSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Nieprawidłowe dane.',
      details: z.flattenError(parsed.error),
    });
  }

  const { error } = await locals.supabase
    .from('book_candidates')
    .delete()
    .eq('id', parsed.data.candidate_id)
    .eq('detection_id', detectionId)
    .eq('source', 'manual')
    .is('edited_at', null);

  if (error) {
    console.error('[api/detections candidate DELETE] delete failed', {
      name: error.name,
      message: error.message,
      code: error.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd serwera.' });
  }

  return apiResponse({ data: { deleted: true } });
};
