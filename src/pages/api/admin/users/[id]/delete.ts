import type { APIRoute } from 'astro';

import { requireAdmin } from '../../../../../lib/admin/guard';
import { createAdminSupabaseClient } from '../../../../../lib/db/supabase.admin';
import { apiError, apiResponse, parseUuidParam } from '../../../../../lib/http/response';

export const prerender = false;

/**
 * POST /api/admin/users/[id]/delete
 *
 * Soft delete konta: anonimizacja profilu + emaila + zmiana hasła na random → blokada logowania.
 * Dane (books, shelves, photos) pozostają w bazie.
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
      message: 'Nie możesz usunąć własnego konta przez panel admina.',
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
    console.error('[api/admin/users/[id]/delete POST] profile fetch failed', {
      message: profileError.message,
      code: profileError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd serwera.' });
  }

  if (profileData.deleted_at !== null) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Konto już zostało usunięte.',
    });
  }

  if (profileData.is_admin === true) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Nie można usunąć konta administratora.',
    });
  }

  // Krok 1: anonimizacja profilu (DB-first — decydujący krok)
  const { error: updateError } = await adminClient
    .from('profiles')
    .update({ deleted_at: new Date().toISOString(), display_name: 'Użytkownik usunięty' })
    .eq('id', id);

  if (updateError) {
    console.error('[api/admin/users/[id]/delete POST] profile update failed', {
      message: updateError.message,
      code: updateError.code,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się usunąć konta.',
    });
  }

  // Krok 2: anonimizacja auth (best-effort — blokada logowania)
  const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(id, {
    email: `deleted-${id}@bookshelf.deleted`,
    password: crypto.randomUUID(),
    email_confirm: true,
  });

  if (authUpdateError) {
    console.error('[api/admin/users/[id]/delete POST] auth anonymization failed (best-effort)', {
      message: authUpdateError instanceof Error ? authUpdateError.message : String(authUpdateError),
    });
    // Nie zwracamy 500 — profil już zanonimizowany; blokada logowania może być niepełna
  }

  return apiResponse({ data: { deleted: true } });
};
