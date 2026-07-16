import type { APIRoute } from 'astro';

import { apiError, apiResponse } from '../../../lib/http/response';

export const prerender = false;

/**
 * POST /api/account/reset-resolution-usage
 *
 * Akcja (nie deklaratywne pole): ustawia `ai_resolution_daily_reset_at = now()` dla
 * zalogowanego użytkownika, żeby miękko wyzerować dzisiejszy licznik AI-resolution bez
 * naruszania append-only `resolution_calls`. Server-side timestamp (nigdy z body) — unika
 * spoofingu/clock-skew.
 */
export const POST: APIRoute = async ({ locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const { data, error } = await locals.supabase
    .from('profiles')
    .update({ ai_resolution_daily_reset_at: new Date().toISOString() })
    .eq('id', locals.user.id)
    .select('ai_resolution_daily_reset_at')
    .single();

  if (error) {
    console.error('[api/account/reset-resolution-usage POST] supabase update failed', {
      name: error.name,
      message: error.message,
      code: error.code,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się wyzerować dzisiejszego licznika.',
    });
  }

  return apiResponse({ data: { reset_at: data.ai_resolution_daily_reset_at } });
};
