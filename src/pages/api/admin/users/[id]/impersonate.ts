import type { APIRoute } from 'astro';

import { requireAdmin } from '../../../../../lib/admin/guard';
import { createAdminSupabaseClient } from '../../../../../lib/db/supabase.admin';
import { apiError, apiResponse, parseUuidParam } from '../../../../../lib/http/response';

export const prerender = false;

/**
 * POST /api/admin/users/[id]/impersonate
 *
 * Generuje jednorazowy magic link dla wskazanego użytkownika.
 * Guard: brak impersonacji siebie, adminów i soft-deleted kont.
 */
export const POST: APIRoute = async ({ params, locals }) => {
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
      message: 'Nie możesz impersonować własnego konta.',
    });
  }

  const adminClient = createAdminSupabaseClient();

  const { data: profileData, error: profileError } = await adminClient
    .from('profiles')
    .select('deleted_at, is_admin')
    .eq('id', id)
    .single();

  if (profileError) {
    if (profileError.code === 'PGRST116') {
      return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono użytkownika.' });
    }
    console.error('[api/admin/users/[id]/impersonate POST] profile fetch failed', {
      message: profileError.message,
      code: profileError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd serwera.' });
  }

  if (profileData.deleted_at !== null) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Konto zostało usunięte.',
    });
  }

  if (profileData.is_admin === true) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Nie można impersonować administratora.',
    });
  }

  const { data: authUser, error: getUserError } = await adminClient.auth.admin.getUserById(id);

  if (getUserError || !authUser.user?.email) {
    console.error('[api/admin/users/[id]/impersonate POST] getUserById failed', {
      message: getUserError instanceof Error ? getUserError.message : String(getUserError),
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd serwera.' });
  }

  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: 'magiclink',
    email: authUser.user.email,
  });

  if (linkError || !linkData.properties?.action_link) {
    console.error('[api/admin/users/[id]/impersonate POST] generateLink failed', {
      message: linkError instanceof Error ? linkError.message : String(linkError),
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się wygenerować linku impersonacji.',
    });
  }

  return apiResponse({
    data: {
      action_link: linkData.properties.action_link,
      email_otp: linkData.properties.email_otp,
      email: authUser.user.email,
    },
  });
};
