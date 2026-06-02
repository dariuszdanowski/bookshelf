import type { APIRoute } from 'astro';

import { CheckDuplicateSchema } from '../../../lib/photos/schema';
import { apiError, apiResponse } from '../../../lib/http/response';

export const prerender = false;

/**
 * GET /api/photos/check-hash?hash=<sha256-hex>
 *
 * Sprawdza czy zdjęcie o podanym SHA-256 już istnieje w katalogu usera.
 * Wołane z przeglądarki przed uploadem — zero kosztu gdy duplikat wykryty wcześnie.
 *
 * Odpowiedź: { data: { photo: { id, shelf_id, created_at } } } lub { data: { photo: null } }
 */
export const GET: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const url = new URL(request.url);
  const rawHash = url.searchParams.get('hash') ?? undefined;

  const parsed = CheckDuplicateSchema.safeParse({ hash: rawHash });
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Parametr hash musi być 64-znakowym hex SHA-256.',
    });
  }

  const { data, error } = await locals.supabase
    .from('photos')
    .select('id, shelf_id, created_at')
    .eq('user_id', locals.user.id)
    .eq('file_hash_sha256', parsed.data.hash)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[api/photos/check-hash GET] supabase query failed', {
      name: error.name,
      message: error.message,
      code: error.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd sprawdzania duplikatu.' });
  }

  return apiResponse({ data: { photo: data ?? null } });
};
