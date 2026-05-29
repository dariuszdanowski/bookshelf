import type { APIRoute } from 'astro';
import { z } from 'zod';
import { apiError, apiResponse, parseUuidParam } from '../../../../lib/http/response';
import { ConfirmDetectionSchema } from '../../../../lib/books/schema';
import { confirmDetectionToCatalog } from '../../../../lib/books/confirm';

export const prerender = false;

/**
 * POST /api/detections/[id]/confirm
 *
 * Akceptuje wskazanego kandydata (as-is). Tworzy wpis w katalogu.
 * Telemetria: correction_type = 'accept'.
 *
 * Body: { candidate_id: uuid }
 * 200: { data: { book_id, shelf_id } }
 * 409: exact-dup (isbn_13 już w katalogu usera)
 * 404: detekcja / kandydat / zdjęcie nie istnieje lub cudze
 * 400: walidacja Zod
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
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
    return apiError({ code: 'VALIDATION_ERROR', status: 400, message: 'Nieprawidłowe ciało żądania.' });
  }

  const parsed = ConfirmDetectionSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Nieprawidłowe dane.',
      details: z.flattenError(parsed.error),
    });
  }

  const { candidate_id } = parsed.data;

  // Pobierz detekcję (RLS scoped)
  const { data: detection, error: detError } = await locals.supabase
    .from('detections')
    .select('id, status, photo_id, position_index, raw_title')
    .eq('id', detectionId)
    .maybeSingle();

  if (detError) {
    console.error('[api/detections confirm] detections select failed', {
      name: detError.name,
      message: detError.message,
      code: detError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd serwera.' });
  }
  if (!detection) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono detekcji.' });
  }

  // Pobierz shelf_id z photo (RLS: photo.user_id = auth.uid())
  const { data: photo, error: photoError } = await locals.supabase
    .from('photos')
    .select('shelf_id')
    .eq('id', detection.photo_id)
    .maybeSingle();

  if (photoError) {
    console.error('[api/detections confirm] photos select failed', {
      name: photoError.name,
      message: photoError.message,
      code: photoError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd serwera.' });
  }
  if (!photo) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono zdjęcia.' });
  }

  // Pobierz kandydata (RLS via detection_id → photo)
  const { data: candidate, error: candError } = await locals.supabase
    .from('book_candidates')
    .select('id, source, external_id, title, authors, isbn_10, isbn_13, publisher, published_year, cover_url')
    .eq('id', candidate_id)
    .eq('detection_id', detectionId)
    .maybeSingle();

  if (candError) {
    console.error('[api/detections confirm] book_candidates select failed', {
      name: candError.name,
      message: candError.message,
      code: candError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd serwera.' });
  }
  if (!candidate) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono kandydata.' });
  }

  const result = await confirmDetectionToCatalog(locals.supabase, locals.user.id, {
    detection: {
      id: detection.id,
      status: detection.status,
      photo_id: detection.photo_id,
      position_index: detection.position_index,
      raw_title: detection.raw_title,
    },
    shelfId: photo.shelf_id,
    book: {
      title: candidate.title,
      authors: candidate.authors,
      isbn_10: candidate.isbn_10,
      isbn_13: candidate.isbn_13,
      publisher: candidate.publisher,
      published_year: candidate.published_year,
      cover_url: candidate.cover_url,
      source: candidate.source,
      source_external_id: candidate.external_id,
    },
    correctionType: 'accept',
  });

  if (!result.ok) {
    if (result.reason === 'already_confirmed') {
      return apiError({ code: 'CONFLICT', status: 409, message: 'Detekcja została już zaakceptowana.' });
    }
    if (result.reason === 'write_failed') {
      return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się zapisać książki do katalogu.' });
    }
    // duplicate
    const msg = result.shelfHint
      ? `Masz już tę książkę w katalogu (półka: ${result.shelfHint}).`
      : 'Masz już tę książkę w katalogu.';
    return apiError({ code: 'CONFLICT', status: 409, message: msg });
  }

  return apiResponse({ data: { book_id: result.bookId, shelf_id: photo.shelf_id } });
};
