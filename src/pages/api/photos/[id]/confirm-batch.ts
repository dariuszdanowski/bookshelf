import type { APIRoute } from 'astro';
import { z } from 'zod';
import { apiError, apiResponse, parseUuidParam } from '../../../../lib/http/response';
import { ConfirmBatchSchema } from '../../../../lib/books/schema';
import { confirmDetectionToCatalog } from '../../../../lib/books/confirm';

export const prerender = false;

/**
 * POST /api/photos/[id]/confirm-batch
 *
 * Hurtowa akceptacja pre-zaznaczonych detekcji (≥0.75) jednym round-tripem.
 * Atomowość per-item: dup/already_confirmed → skipped, reszta kontynuuje.
 *
 * Body: { items: [{ detection_id, candidate_id }] }
 * 200: { data: { confirmed: [...], skipped: [...] } }
 * 400: pusta lista / walidacja Zod / detekcje nie należą do zdjęcia
 * 404: zdjęcie nie istnieje lub cudze
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const photoId = parseUuidParam(params.id);
  if (!photoId) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono zdjęcia.' });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError({ code: 'VALIDATION_ERROR', status: 400, message: 'Nieprawidłowe ciało żądania.' });
  }

  const parsed = ConfirmBatchSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Nieprawidłowe dane.',
      details: z.flattenError(parsed.error),
    });
  }

  const { items } = parsed.data;

  // Pobierz zdjęcie (RLS scoped)
  const { data: photo, error: photoError } = await locals.supabase
    .from('photos')
    .select('id, shelf_id')
    .eq('id', photoId)
    .maybeSingle();

  if (photoError) {
    console.error('[api/photos confirm-batch] photos select failed', {
      name: photoError.name,
      message: photoError.message,
      code: photoError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd serwera.' });
  }
  if (!photo) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono zdjęcia.' });
  }

  const detectionIds = items.map((i) => i.detection_id);
  const candidateIds = items.map((i) => i.candidate_id);

  // Pobierz detekcje (RLS, filtrujemy po photo_id żeby uniknąć cross-photo inject)
  const { data: detRows, error: detError } = await locals.supabase
    .from('detections')
    .select('id, status, photo_id, position_index, raw_title')
    .in('id', detectionIds)
    .eq('photo_id', photoId);

  if (detError) {
    console.error('[api/photos confirm-batch] detections select failed', {
      name: detError.name,
      message: detError.message,
      code: detError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd serwera.' });
  }

  const detectionsMap = new Map((detRows ?? []).map((d) => [d.id, d]));

  // Pobierz kandydatów (filtrujemy po detection_id — bezpieczne)
  const { data: candRows, error: candError } = await locals.supabase
    .from('book_candidates')
    .select('id, detection_id, source, external_id, title, authors, isbn_10, isbn_13, publisher, published_year, cover_url')
    .in('id', candidateIds)
    .in('detection_id', detectionIds);

  if (candError) {
    console.error('[api/photos confirm-batch] book_candidates select failed', {
      name: candError.name,
      message: candError.message,
      code: candError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd serwera.' });
  }

  const candidatesMap = new Map((candRows ?? []).map((c) => [c.id, c]));

  const confirmed: { detection_id: string; book_id: string }[] = [];
  const skipped: { detection_id: string; reason: string }[] = [];

  for (const item of items) {
    const detection = detectionsMap.get(item.detection_id);
    if (!detection) {
      skipped.push({ detection_id: item.detection_id, reason: 'not_found' });
      continue;
    }

    const candidate = candidatesMap.get(item.candidate_id);
    if (!candidate) {
      skipped.push({ detection_id: item.detection_id, reason: 'candidate_not_found' });
      continue;
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

    if (result.ok) {
      confirmed.push({ detection_id: item.detection_id, book_id: result.bookId });
    } else {
      skipped.push({ detection_id: item.detection_id, reason: result.reason });
    }
  }

  return apiResponse({ data: { confirmed, skipped } });
};
