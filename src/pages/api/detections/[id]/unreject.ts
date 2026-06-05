import type { APIRoute } from 'astro';
import { apiError, apiResponse, parseUuidParam } from '../../../../lib/http/response';

export const prerender = false;

/**
 * POST /api/detections/[id]/unreject
 *
 * Cofa odrzucenie detekcji (akcja „Cofnij" w review UI). Status 'rejected' wraca
 * do 'matched' (gdy detekcja ma kandydatów) lub 'pending' (gdy nie ma). Usuwa też
 * telemetrię `correction_type = 'reject'` dla tej detekcji — odrzucenie, które user
 * cofnął, nie jest realnym odrzuceniem i nie powinno zatruwać statystyk korekt.
 *
 * Body: brak
 * 200: { data: { status: 'matched' | 'pending' } }
 * 404: detekcja nie istnieje lub cudza (RLS scope)
 */
export const POST: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const detectionId = parseUuidParam(params.id);
  if (!detectionId) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono detekcji.' });
  }

  const { data: detection, error: detError } = await locals.supabase
    .from('detections')
    .select('id, status')
    .eq('id', detectionId)
    .maybeSingle();

  if (detError) {
    console.error('[api/detections unreject] detections select failed', {
      name: detError.name,
      message: detError.message,
      code: detError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd serwera.' });
  }
  if (!detection) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono detekcji.' });
  }

  // Status docelowy: 'matched' gdy detekcja ma kandydatów, inaczej 'pending'.
  const { count, error: countError } = await locals.supabase
    .from('book_candidates')
    .select('id', { count: 'exact', head: true })
    .eq('detection_id', detectionId);

  if (countError) {
    console.error('[api/detections unreject] candidates count failed', {
      name: countError.name,
      message: countError.message,
      code: countError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd serwera.' });
  }

  const nextStatus = (count ?? 0) > 0 ? 'matched' : 'pending';

  const { error: updateError } = await locals.supabase
    .from('detections')
    .update({ status: nextStatus })
    .eq('id', detectionId);

  if (updateError) {
    console.error('[api/detections unreject] detections update failed', {
      name: updateError.name,
      message: updateError.message,
      code: updateError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się cofnąć odrzucenia.' });
  }

  // Best-effort: skasuj telemetrię odrzucenia (cofnięte odrzucenie ≠ odrzucenie).
  await locals.supabase
    .from('corrections')
    .delete()
    .eq('detection_id', detectionId)
    .eq('correction_type', 'reject');

  return apiResponse({ data: { status: nextStatus } });
};
