import type { APIRoute } from 'astro';

import { apiError, apiResponse } from '../../../lib/http/response';

export const prerender = false;

/**
 * POST /api/auth/logout
 *
 * signOut → cookie cleared przez @supabase/ssr cookie adapter (z F-01) →
 * następny request middleware widzi locals.user=null. Idempotent: no-op gdy
 * user był już null (whitelist'owana ścieżka, więc niezalogowani też mogą
 * trafić bez 401).
 */
export const POST: APIRoute = async ({ locals }) => {
  const { error } = await locals.supabase.auth.signOut();

  if (error) {
    console.error('[api/auth/logout] supabase signOut failed', {
      err: error.message,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Logout failed.',
    });
  }

  return apiResponse({ data: { redirect: '/' } });
};
