import type { APIRoute } from 'astro';
import { unconfirmDetectionFromCatalog } from '../../../../lib/books/confirm';
import { apiError, apiResponse, parseUuidParam } from '../../../../lib/http/response';

export const prerender = false;

/**
 * POST /api/detections/[id]/unconfirm
 *
 * Cofa akceptację detekcji (akcja „Cofnij" w review UI). Usuwa książkę z
 * katalogu i półki (orphan-safe), przywraca status detekcji do
 * 'matched'/'pending', czyści telemetrię akceptacji. Symetria do unreject.
 *
 * Body: brak
 * 200: { data: { status: 'matched' | 'pending' } }
 * 404: detekcja nie istnieje lub cudza (RLS scope)
 * 409: detekcja nie jest w statusie 'confirmed'
 */
export const POST: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const detectionId = parseUuidParam(params.id);
  if (!detectionId) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono detekcji.' });
  }

  let result;
  try {
    result = await unconfirmDetectionFromCatalog(locals.supabase, locals.user.id, detectionId);
  } catch (err) {
    console.error('[api/detections unconfirm] unexpected error', {
      name: err instanceof Error ? err.name : 'unknown',
      code: (err as { code?: string }).code,
      message: err instanceof Error ? err.message : String(err),
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd serwera.' });
  }

  if (!result.ok) {
    if (result.reason === 'not_found') {
      return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono detekcji.' });
    }
    return apiError({
      code: 'CONFLICT',
      status: 409,
      message: 'Detekcja nie jest zaakceptowana.',
    });
  }

  return apiResponse({ data: { status: result.status } });
};
