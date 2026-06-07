import type { APIRoute } from 'astro';

import { apiError, apiResponse } from '../../../lib/http/response';

export const prerender = false;

/**
 * GET /api/account/stats
 *
 * Agregat kosztów vision per zalogowany user — niezależny od istnienia zdjęć
 * (vision_runs/refine_calls przeżywają DELETE photo dzięki FK SET NULL z migracji
 * 0015). RLS-respecting (locals.supabase): vision_runs.user_id + refine_calls.user_id.
 *
 * `(locals.supabase as any)`: vision_runs.user_id to nowa kolumna (0015) a
 * refine_calls nie jest w `database.types.ts` — types regen dopiero po `db push`
 * (precedens `photos/[id]/costs.ts`).
 *
 * Odpowiedź: { data: { total_vision_cost_usd, total_refine_cost_usd, vision_run_count, refine_call_count } }
 */
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  type CostRow = { cost_usd: number | null; api_key_id?: string | null };
  type Result = { data: CostRow[] | null; error: { code?: string; message: string } | null };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = locals.supabase as any;
  const userId = locals.user.id;

  // M27: select z api_key_id (atrybucja per klucz); defensywny retry bez
  // kolumny (42703 undefined_column) dopóki migracja 0020 nie dotrze na prod.
  async function selectCosts(table: string, succeededOnly: boolean): Promise<Result> {
    const build = (cols: string) => {
      let q = sb.from(table).select(cols).eq('user_id', userId);
      if (succeededOnly) q = q.eq('status', 'succeeded');
      return q;
    };
    const withKey = (await build('cost_usd, api_key_id')) as Result;
    if (withKey.error?.code === '42703') return (await build('cost_usd')) as Result;
    return withKey;
  }

  // vision_runs: tylko 'succeeded' (running/failed mają cost_usd NULL → zawyżają count)
  const visionResult = await selectCosts('vision_runs', true);

  if (visionResult.error) {
    console.error('[api/account/stats GET] vision_runs failed', {
      message: visionResult.error.message,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd pobierania statystyk.' });
  }

  const refineResult = await selectCosts('refine_calls', false);

  if (refineResult.error) {
    console.error('[api/account/stats GET] refine_calls failed', {
      message: refineResult.error.message,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd pobierania statystyk.' });
  }

  const visionRuns = visionResult.data ?? [];
  const refineCalls = refineResult.data ?? [];

  // M27: suma kosztów per klucz (vision + refine razem) — /account pokazuje
  // wartość przy każdym kluczu. Wywołania bez atrybucji (sprzed migracji
  // 0020 / klucz env) nie wliczają się do żadnego klucza.
  const costByKey = new Map<string, { cost_usd: number; call_count: number }>();
  for (const row of [...visionRuns, ...refineCalls]) {
    if (!row.api_key_id) continue;
    const agg = costByKey.get(row.api_key_id) ?? { cost_usd: 0, call_count: 0 };
    agg.cost_usd += row.cost_usd ?? 0;
    agg.call_count += 1;
    costByKey.set(row.api_key_id, agg);
  }

  return apiResponse({
    data: {
      total_vision_cost_usd: visionRuns.reduce((s, r) => s + (r.cost_usd ?? 0), 0),
      total_refine_cost_usd: refineCalls.reduce((s, r) => s + (r.cost_usd ?? 0), 0),
      vision_run_count: visionRuns.length,
      refine_call_count: refineCalls.length,
      cost_by_key: Object.fromEntries(costByKey),
    },
  });
};
