import type { APIRoute } from 'astro';

import { requireAdmin } from '../../../../lib/admin/guard';
import { createAdminSupabaseClient } from '../../../../lib/db/supabase.admin';
import { apiError, apiResponse } from '../../../../lib/http/response';

export const prerender = false;

export type UserAdminDTO = {
  id: string;
  email: string;
  display_name: string | null;
  is_admin: boolean;
  ai_enabled: boolean;
  is_technical: boolean;
  deleted_at: string | null;
  created_at: string;
  book_count: number;
  shelf_count: number;
};

/**
 * GET /api/admin/users
 *
 * Lista wszystkich użytkowników aplikacji dla panelu admina.
 * Łączy auth.users (email) z profiles (flagi) i licznikami books/shelves.
 */
export const GET: APIRoute = async ({ locals }) => {
  const guard = await requireAdmin(locals);
  if (guard) return guard;

  const adminClient = createAdminSupabaseClient();

  // Pobieramy auth users (max 1000 — aplikacja małoskalowa)
  const { data: authData, error: authError } = await adminClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (authError) {
    console.error('[api/admin/users GET] auth.admin.listUsers failed', {
      message: authError instanceof Error ? authError.message : String(authError),
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się pobrać listy użytkowników.',
    });
  }

  // Równolegle: profiles + book counts + shelf counts
  const [profilesResult, bookCountsResult, shelfCountsResult] = await Promise.all([
    adminClient
      .from('profiles')
      .select('id, display_name, is_admin, ai_enabled, is_technical, deleted_at, created_at'),
    adminClient.from('books').select('user_id'),
    adminClient.from('shelves').select('user_id'),
  ]);

  if (profilesResult.error) {
    console.error('[api/admin/users GET] profiles fetch failed', {
      message: profilesResult.error.message,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się pobrać profili.',
    });
  }

  // Budujemy mapy do szybkiego lookup
  const profileMap = new Map(profilesResult.data.map((p) => [p.id, p]));

  const bookCountMap = new Map<string, number>();
  for (const row of bookCountsResult.data ?? []) {
    bookCountMap.set(row.user_id, (bookCountMap.get(row.user_id) ?? 0) + 1);
  }

  const shelfCountMap = new Map<string, number>();
  for (const row of shelfCountsResult.data ?? []) {
    shelfCountMap.set(row.user_id, (shelfCountMap.get(row.user_id) ?? 0) + 1);
  }

  const users: UserAdminDTO[] = authData.users
    .map((authUser) => {
      const profile = profileMap.get(authUser.id);
      return {
        id: authUser.id,
        email: authUser.email ?? '',
        display_name: profile?.display_name ?? null,
        is_admin: profile?.is_admin ?? false,
        ai_enabled: profile?.ai_enabled ?? true,
        is_technical: profile?.is_technical ?? false,
        deleted_at: profile?.deleted_at ?? null,
        created_at: authUser.created_at,
        book_count: bookCountMap.get(authUser.id) ?? 0,
        shelf_count: shelfCountMap.get(authUser.id) ?? 0,
      };
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return apiResponse({ data: { users } });
};
