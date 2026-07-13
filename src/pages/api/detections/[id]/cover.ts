import type { APIRoute } from 'astro';
import { z } from 'zod';

import { apiError, apiResponse, parseUuidParam } from '../../../../lib/http/response';
import { UpdateCandidateCoverSchema } from '../../../../lib/books/schema';

export const prerender = false;

/**
 * PATCH /api/detections/[id]/cover
 *
 * Nadpisuje okładkę kandydata (book_candidates.cover_url) PRZED zatwierdzeniem
 * detekcji do katalogu (candidate-cover-override). confirm.ts/correct.ts czytają
 * tę kolumnę świeżo przy zatwierdzeniu, więc zero zmian tam jest potrzebne.
 *
 * Body: { candidate_id: uuid, cover_url: string | null }
 * 200: { data: { candidate_id, cover_url } }
 * 404: detekcja / kandydat nie istnieje, cudzy, lub kandydat nie należy do tej detekcji
 * 400: walidacja Zod (zły URL)
 *
 * Adaptacja literalna vs plan: pojedynczy update+select (wzorzec bbox.ts) zamiast
 * osobnego select-detekcji + update-kandydata (wzorzec confirm.ts) — WHERE
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

  const parsed = UpdateCandidateCoverSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Nieprawidłowe dane.',
      details: z.flattenError(parsed.error),
    });
  }

  const { candidate_id, cover_url } = parsed.data;

  const { data: rows, error } = await locals.supabase
    .from('book_candidates')
    .update({ cover_url })
    .eq('id', candidate_id)
    .eq('detection_id', detectionId)
    .select('id, cover_url');

  if (error) {
    console.error('[api/detections cover PATCH] update failed', {
      name: error.name,
      message: error.message,
      code: error.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd serwera.' });
  }

  if (!rows || rows.length === 0) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono kandydata.' });
  }

  return apiResponse({ data: { candidate_id: rows[0].id, cover_url: rows[0].cover_url } });
};
