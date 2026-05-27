import type { APIRoute } from 'astro';

import { type PhotoDTO, type DetectionDTO } from '../../../lib/photos/schema';
import { apiError, apiResponse, parseUuidParam } from '../../../lib/http/response';

export const prerender = false;

/**
 * GET /api/photos/[id]
 *
 * Zwraca PhotoDTO + (gdy status='processed') listę DetectionDTO.
 * Page-reload persistence — po odświeżeniu UI pokazuje status/detekcje
 * ostatniego zdjęcia i zasila stan retry.
 *
 * `parseUuidParam` → 404 przy zniekształconym UUID (privacy-first, FR-NFR).
 * PGRST116 (no rows z `.single()`) → 404 NOT_FOUND.
 */
export const GET: APIRoute = async ({ params, locals }) => {
  const id = parseUuidParam(params.id);
  if (!id) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Not found.' });
  }

  const { data, error } = await locals.supabase
    .from('photos')
    .select('id, shelf_id, status, detected_count, error_message, vision_cost_usd, vision_latency_ms, created_at')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return apiError({ code: 'NOT_FOUND', status: 404, message: 'Not found.' });
    }
    console.error('[api/photos GET] supabase select failed', {
      name: error.name,
      message: error.message,
      code: error.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się pobrać zdjęcia.' });
  }

  const photo: PhotoDTO = {
    id: data.id,
    shelf_id: data.shelf_id,
    status: data.status,
    detected_count: data.detected_count,
    error_message: data.error_message,
    vision_cost_usd: data.vision_cost_usd,
    vision_latency_ms: data.vision_latency_ms,
    created_at: data.created_at,
  };

  if (data.status !== 'processed') {
    return apiResponse({ data: { photo } });
  }

  const { data: detRows, error: detError } = await locals.supabase
    .from('detections')
    .select('position_index, raw_title, raw_author, vision_confidence, spine_color')
    .eq('photo_id', id)
    .order('position_index', { ascending: true });

  if (detError) {
    console.error('[api/photos GET] detections select failed', {
      name: detError.name,
      message: detError.message,
      code: detError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się pobrać detekcji.' });
  }

  const detections: DetectionDTO[] = (detRows ?? []).map((row) => ({
    position_index: row.position_index,
    raw_title: row.raw_title ?? '',
    raw_author: row.raw_author,
    vision_confidence: row.vision_confidence,
    spine_color: row.spine_color,
  }));

  return apiResponse({ data: { photo, detections } });
};
