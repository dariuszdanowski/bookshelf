import type { App } from 'astro/app';
import { apiError } from '../http/response';

type Locals = App.Locals;

/**
 * Reusable guard dla admin-only endpointów.
 *
 * Użycie: `const g = await requireAdmin(locals); if (g) return g;`
 *
 * Zwraca null gdy caller jest zalogowanym adminem.
 * Zwraca Response 401/403 w przeciwnym razie.
 *
 * Weryfikacja `is_admin` przez RLS-respecting client (`locals.supabase`) —
 * użytkownik może czytać tylko własny profil, więc sprawdzamy czy faktycznie
 * jest adminem zamiast ufać tokenu.
 */
export async function requireAdmin(locals: Locals): Promise<Response | null> {
  if (!locals.user) {
    return apiError({
      code: 'UNAUTHENTICATED',
      status: 401,
      message: 'Authentication required.',
    });
  }

  const { data: profile, error } = await locals.supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', locals.user.id)
    .single();

  if (error || !profile?.is_admin) {
    return apiError({
      code: 'ADMIN_REQUIRED',
      status: 403,
      message: 'Admin access required.',
    });
  }

  return null;
}
