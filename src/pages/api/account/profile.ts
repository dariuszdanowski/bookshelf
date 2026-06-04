import type { APIRoute } from 'astro';
import { z } from 'zod';

import { UpdateProfileSchema } from '../../../lib/account/schema';
import { apiError, apiResponse } from '../../../lib/http/response';

// Cloudflare Workers wymóg @astrojs/cloudflare przy output: 'server'.
export const prerender = false;

/**
 * PATCH /api/account/profile
 *
 * Aktualizuje `display_name` zalogowanego usera. RLS (`profiles_update_own`)
 * scopuje update do `auth.uid()`; `.eq('id', user.id)` dodane explicite dla
 * czytelności + parytetu z `.single()`. Profil zawsze istnieje (bootstrap
 * `handle_new_user`, migracja 0003), więc 0 rows = nieoczekiwany stan → 404.
 *
 * Body: `{ display_name }`. Email/hasło NIE idą tędy — to browser
 * `supabase.auth.updateUser` (S-31 Phase 3).
 */
export const PATCH: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError({ code: 'VALIDATION_ERROR', status: 400, message: 'Invalid JSON body.' });
  }

  const parsed = UpdateProfileSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Invalid profile input.',
      details: z.flattenError(parsed.error),
    });
  }

  const { data, error } = await locals.supabase
    .from('profiles')
    .update({ display_name: parsed.data.display_name })
    .eq('id', locals.user.id)
    .select('id, display_name')
    .single();

  if (error) {
    // PGRST116 = no rows (Supabase REST przy .single() i 0 rows) → 404.
    if (error.code === 'PGRST116') {
      return apiError({ code: 'NOT_FOUND', status: 404, message: 'Profil nie istnieje.' });
    }
    console.error('[api/account/profile PATCH] supabase update failed', {
      name: error.name,
      message: error.message,
      code: error.code,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się zaktualizować profilu.',
    });
  }

  return apiResponse({ data: { profile: { id: data.id, display_name: data.display_name } } });
};
