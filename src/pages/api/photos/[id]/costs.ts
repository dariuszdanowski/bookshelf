import type { APIRoute } from 'astro';
import { apiError, apiResponse, parseUuidParam } from '../../../../lib/http/response';

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const photoId = parseUuidParam(params.id);
  if (!photoId) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono zdjęcia.' });
  }

  // Verify photo ownership
  const { data: photo } = await locals.supabase
    .from('photos')
    .select('id')
    .eq('id', photoId)
    .maybeSingle();
  if (!photo) return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono zdjęcia.' });

  // Vision runs for this photo
  const { data: visionRuns, error: vrError } = await locals.supabase
    .from('vision_runs')
    .select('id, model, cost_usd, latency_ms, created_at, status')
    .eq('photo_id', photoId)
    .order('created_at', { ascending: true });

  if (vrError) {
    console.error('[api/photos/costs GET] vision_runs failed', vrError.message);
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd pobierania danych vision.' });
  }

  // Refine calls for this photo (joined with detection position_index)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: refineCalls, error: rcError } = await (locals.supabase as any)
    .from('refine_calls')
    .select('id, detection_id, model, cost_usd, latency_ms, created_at, detections(position_index, raw_title)')
    .eq('photo_id', photoId)
    .order('created_at', { ascending: true }) as {
      data: Array<{ id: string; detection_id: string; model: string | null; cost_usd: number | null; latency_ms: number | null; created_at: string; detections: { position_index: number; raw_title: string } | null }> | null;
      error: { message: string } | null;
    };

  if (rcError) {
    // Graceful degrade: tabela refine_calls może nie istnieć jeszcze w DB
    // (migracja 0012 czeka na merge+push). Zamiast 500 zwracamy pustą listę.
    console.warn('[api/photos/costs GET] refine_calls unavailable — returning []', rcError.message);
  }

  const visionTotal = (visionRuns ?? []).reduce((s, r) => s + (r.cost_usd ?? 0), 0);
  const refineTotal = (refineCalls ?? []).reduce((s, r) => s + (r.cost_usd ?? 0), 0);

  return apiResponse({
    data: {
      vision_runs: (visionRuns ?? []).map((r) => ({
        id: r.id,
        model: r.model,
        cost_usd: r.cost_usd,
        latency_ms: r.latency_ms,
        status: r.status,
        created_at: r.created_at,
      })),
      refine_calls: (refineCalls ?? []).map((r) => {
        const det = r.detections as { position_index: number; raw_title: string } | null;
        return {
          id: r.id,
          detection_id: r.detection_id,
          position_index: det?.position_index ?? null,
          raw_title: det?.raw_title ?? null,
          model: r.model,
          cost_usd: r.cost_usd,
          latency_ms: r.latency_ms,
          created_at: r.created_at,
        };
      }),
      totals: {
        vision_cost_usd: visionTotal,
        refine_cost_usd: refineTotal,
        grand_total_usd: visionTotal + refineTotal,
        call_count: (visionRuns?.length ?? 0) + (refineCalls?.length ?? 0),
      },
    },
  });
};
