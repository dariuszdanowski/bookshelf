import type { APIRoute } from 'astro';
import { apiError, apiResponse, parseUuidParam } from '../../../../lib/http/response';

export const prerender = false;

/**
 * POST /api/detections/[id]/reject
 *
 * Odrzuca detekcję (np. system wymyślił grzbiet którego nie ma).
 * Brak wpisu do katalogu; tylko telemetria correction_type = 'reject'.
 *
 * Body: brak
 * 200: { data: { rejected: true } }
 * 404: detekcja nie istnieje lub cudza
 */
export const POST: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const detectionId = parseUuidParam(params.id);
  if (!detectionId) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono detekcji.' });
  }

  // Pobierz detekcję (RLS scoped przez photo)
  const { data: detection, error: detError } = await locals.supabase
    .from('detections')
    .select('id, raw_title')
    .eq('id', detectionId)
    .maybeSingle();

  if (detError) {
    console.error('[api/detections reject] detections select failed', {
      name: detError.name,
      message: detError.message,
      code: detError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd serwera.' });
  }
  if (!detection) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono detekcji.' });
  }

  // UPDATE status = 'rejected'
  const { error: updateError } = await locals.supabase
    .from('detections')
    .update({ status: 'rejected' })
    .eq('id', detectionId);

  if (updateError) {
    console.error('[api/detections reject] detections update failed', {
      name: updateError.name,
      message: updateError.message,
      code: updateError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się odrzucić detekcji.' });
  }

  // INSERT corrections (telemetria)
  await locals.supabase.from('corrections').insert({
    user_id: locals.user.id,
    detection_id: detectionId,
    original_raw_title: detection.raw_title,
    correction_type: 'reject',
  });

  return apiResponse({ data: { rejected: true } });
};
