import type { APIRoute } from 'astro';
import { z } from 'zod';

import { apiError, apiResponse, parseUuidParam } from '../../../../lib/http/response';
import { UpdateCandidateSchema } from '../../../../lib/books/schema';

export const prerender = false;

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
