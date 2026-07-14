import type { APIRoute } from 'astro';
import { z } from 'zod';
import { apiError, apiResponse, parseUuidParam } from '../../../../lib/http/response';
import { CorrectDetectionSchema } from '../../../../lib/books/schema';
import { confirmDetectionToCatalog } from '../../../../lib/books/confirm';

export const prerender = false;

/**
 * POST /api/detections/[id]/correct
 *
 * Wyłącznie manual_entry (candidate-propose-edit-all-fields: wariant field_edit
 * usunięty — zastąpiony przez PATCH /api/detections/[id]/candidate + /confirm):
 * brak kandydata, wszystko z formularza (np. brak matchu).
 * Telemetria: correction_type = 'manual_entry'.
 *
 * 200: { data: { book_id, shelf_id } }
 * 409: exact-dup lub already_confirmed
 * 404: detekcja / zdjęcie nie istnieje lub cudze
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
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Nieprawidłowe ciało żądania.',
    });
  }

  const parsed = CorrectDetectionSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Nieprawidłowe dane.',
      details: z.flattenError(parsed.error),
    });
  }

  const input = parsed.data;

  // Pobierz detekcję
  const { data: detection, error: detError } = await locals.supabase
    .from('detections')
    .select('id, status, photo_id, position_index, raw_title, spine_color')
    .eq('id', detectionId)
    .maybeSingle();

  if (detError) {
    console.error('[api/detections correct] detections select failed', {
      name: detError.name,
      message: detError.message,
      code: detError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd serwera.' });
  }
  if (!detection) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono detekcji.' });
  }

  // Pobierz shelf_id + purchase info z photo
  const { data: photo, error: photoError } = await locals.supabase
    .from('photos')
    .select('shelf_id, purchase_date, purchase_city, purchase_event')
    .eq('id', detection.photo_id)
    .maybeSingle();

  if (photoError) {
    console.error('[api/detections correct] photos select failed', {
      name: photoError.name,
      message: photoError.message,
      code: photoError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd serwera.' });
  }
  if (!photo) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono zdjęcia.' });
  }

  // manual_entry — wszystko z formularza, brak kandydata więc purchase_price zawsze null
  const bookInput: Parameters<typeof confirmDetectionToCatalog>[2]['book'] = {
    title: input.title,
    authors: input.authors ?? [],
    isbn_10: input.isbn_10 ?? null,
    isbn_13: input.isbn_13 ?? null,
    publisher: input.publisher ?? null,
    published_year: input.published_year ?? null,
    cover_url: null,
    source: 'manual',
    source_external_id: null,
    spine_color: detection.spine_color,
    description: null,
    purchase_date: photo.purchase_date ?? null,
    purchase_city: photo.purchase_city ?? null,
    purchase_event: photo.purchase_event ?? null,
    purchase_price: null,
  };
  const correctionType = 'manual_entry';
  const correctedFields = { title: input.title, authors: input.authors };

  const result = await confirmDetectionToCatalog(locals.supabase, locals.user.id, {
    detection: {
      id: detection.id,
      status: detection.status,
      photo_id: detection.photo_id,
      position_index: detection.position_index,
      raw_title: detection.raw_title,
    },
    shelfId: photo.shelf_id,
    book: bookInput,
    correctionType,
    correctedFields,
  });

  if (!result.ok) {
    if (result.reason === 'already_confirmed') {
      return apiError({
        code: 'CONFLICT',
        status: 409,
        message: 'Detekcja została już zaakceptowana.',
      });
    }
    if (result.reason === 'write_failed') {
      return apiError({
        code: 'INTERNAL_ERROR',
        status: 500,
        message: 'Nie udało się zapisać książki do katalogu.',
      });
    }
    const msg = result.shelfHint
      ? `Masz już tę książkę w katalogu (półka: ${result.shelfHint}).`
      : 'Masz już tę książkę w katalogu.';
    return apiError({ code: 'CONFLICT', status: 409, message: msg });
  }

  return apiResponse({ data: { book_id: result.bookId, shelf_id: photo.shelf_id } });
};
