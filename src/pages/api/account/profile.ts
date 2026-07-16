import type { APIRoute } from 'astro';
import { z } from 'zod';

import { UpdateProfileSchema } from '../../../lib/account/schema';
import { apiError, apiResponse } from '../../../lib/http/response';

// Cloudflare Workers wymóg @astrojs/cloudflare przy output: 'server'.
export const prerender = false;

/**
 * PATCH /api/account/profile
 *
 * Partial update zalogowanego usera: `display_name` i/lub limity budżetu
 * AI-resolution (`ai_resolution_max_calls_per_photo`/`_per_day`). RLS
 * (`profiles_update_own`) scopuje update do `auth.uid()`; `.eq('id', user.id)`
 * dodane explicite dla czytelności + parytetu z `.single()`. Profil zawsze
 * istnieje (bootstrap `handle_new_user`, migracja 0003), więc 0 rows =
 * nieoczekiwany stan → 404.
 *
 * Body: dowolny podzbiór pól z `UpdateProfileSchema` (min. jedno). Email/hasło
 * NIE idą tędy — to browser `supabase.auth.updateUser` (S-31 Phase 3).
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

  // supabase-js serializuje body przez JSON.stringify, który pomija klucze o wartości
  // undefined — Zod .optional() daje dokładnie undefined dla pominiętych pól, więc to już
  // jest poprawny partial update bez dodatkowej logiki filtrującej klucze.
  const { data, error } = await locals.supabase
    .from('profiles')
    .update({
      display_name: parsed.data.display_name,
      ai_resolution_max_calls_per_photo: parsed.data.ai_resolution_max_calls_per_photo,
      ai_resolution_max_calls_per_day: parsed.data.ai_resolution_max_calls_per_day,
    })
    .eq('id', locals.user.id)
    .select('id, display_name, ai_resolution_max_calls_per_photo, ai_resolution_max_calls_per_day')
    .single();

  if (error) {
    // PGRST116 = no rows (Supabase REST przy .single() i 0 rows) → 404.
    if (error.code === 'PGRST116') {
      return apiError({ code: 'NOT_FOUND', status: 404, message: 'Profil nie istnieje.' });
    }
    // 23514 = check_violation (limity poza zakresem CHECK constraint, defense-in-depth za Zod).
    if (error.code === '23514') {
      return apiError({
        code: 'VALIDATION_ERROR',
        status: 400,
        message: 'Wartość limitu poza dozwolonym zakresem.',
      });
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

  return apiResponse({
    data: {
      profile: {
        id: data.id,
        display_name: data.display_name,
        ai_resolution_max_calls_per_photo: data.ai_resolution_max_calls_per_photo,
        ai_resolution_max_calls_per_day: data.ai_resolution_max_calls_per_day,
      },
    },
  });
};
