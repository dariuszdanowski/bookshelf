import type { APIRoute } from 'astro';
import { z } from 'zod';

import { requireAdmin } from '../../../../../lib/admin/guard';
import { createAdminSupabaseClient } from '../../../../../lib/db/supabase.admin';
import { apiError, apiResponse, parseUuidParam } from '../../../../../lib/http/response';

export const prerender = false;

const BodySchema = z.object({ ai_enabled: z.boolean() });

/**
 * PATCH /api/admin/users/[id]/ai-enabled
 *
 * Toggle flagi ai_enabled na wskazanym profilu.
 * Admin nie może modyfikować własnego konta przez ten endpoint.
 */
export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const guard = await requireAdmin(locals);
  if (guard) return guard;

  const id = parseUuidParam(params.id);
  if (!id) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono użytkownika.' });
  }

  if (id === locals.user!.id) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Nie możesz modyfikować własnego konta przez panel admina.',
    });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError({ code: 'VALIDATION_ERROR', status: 400, message: 'Invalid JSON body.' });
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Pole ai_enabled musi być wartością boolean.',
    });
  }

  const adminClient = createAdminSupabaseClient();

  const { data, error } = await adminClient
    .from('profiles')
    .update({ ai_enabled: parsed.data.ai_enabled })
    .eq('id', id)
    .select('id, ai_enabled')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono użytkownika.' });
    }
    console.error('[api/admin/users/[id]/ai-enabled PATCH] update failed', {
      name: error.name,
      message: error.message,
      code: error.code,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się zaktualizować flagi.',
    });
  }

  return apiResponse({ data: { user: { id: data.id, ai_enabled: data.ai_enabled } } });
};
