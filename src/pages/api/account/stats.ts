import type { APIRoute } from 'astro';

import { apiError, apiResponse } from '../../../lib/http/response';

export const prerender = false;

/**
 * GET /api/account/stats
 *
 * Agregat kosztów vision per zalogowany user — niezależny od istnienia zdjęć
 * (vision_runs/refine_calls przeżywają DELETE photo dzięki FK SET NULL z migracji
 * 0014). RLS-respecting (locals.supabase): vision_runs.user_id + refine_calls.user_id.
 *
 * `(locals.supabase as any)`: vision_runs.user_id to nowa kolumna (0014) a
 * refine_calls nie jest w `database.types.ts` — types regen dopiero po `db push`
 * (precedens `photos/[id]/costs.ts`).
 *
 * Odpowiedź: { data: { total_vision_cost_usd, total_refine_cost_usd, vision_run_count, refine_call_count } }
 */
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  type CostRow = { cost_usd: number | null };
  type Result = { data: CostRow[] | null; error: { message: string } | null };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = locals.supabase as any;

  // vision_runs: tylko 'succeeded' (running/failed mają cost_usd NULL → zawyżają count)
  const visionResult = (await sb
    .from('vision_runs')
    .select('cost_usd')
    .eq('user_id', locals.user.id)
    .eq('status', 'succeeded')) as Result;

  if (visionResult.error) {
    console.error('[api/account/stats GET] vision_runs failed', { message: visionResult.error.message });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd pobierania statystyk.' });
  }

  const refineResult = (await sb
    .from('refine_calls')
    .select('cost_usd')
    .eq('user_id', locals.user.id)) as Result;

  if (refineResult.error) {
    console.error('[api/account/stats GET] refine_calls failed', { message: refineResult.error.message });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd pobierania statystyk.' });
  }

  const visionRuns = visionResult.data ?? [];
  const refineCalls = refineResult.data ?? [];

  return apiResponse({
    data: {
      total_vision_cost_usd: visionRuns.reduce((s, r) => s + (r.cost_usd ?? 0), 0),
      total_refine_cost_usd: refineCalls.reduce((s, r) => s + (r.cost_usd ?? 0), 0),
      vision_run_count: visionRuns.length,
      refine_call_count: refineCalls.length,
    },
  });
};
