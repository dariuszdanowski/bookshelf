import type { APIRoute } from 'astro';
import { z } from 'zod';
import { apiError, apiResponse, parseUuidParam } from '../../../lib/http/response';
import { UpdateBookReadSchema } from '../../../lib/books/schema';

export const prerender = false;

/**
 * PATCH /api/books/:id
 *
 * Aktualizuje is_read (FR-023). Endpoint rozszerzalny (UpdateBookReadSchema
 * .strict() odrzuca dodatkowe pola — żadne inne pola books nie są edytowalne
 * przez ten endpoint w S-05).
 *
 * RLS books_update_own: user może updatować tylko swoje książki;
 * PGRST116 (no rows) → 404 (RLS scope lub brak rekordu).
 *
 * 200: { data: { id, is_read } }
 * 404: nie znaleziono / cudza książka
 * 400: walidacja Zod
 */
export const PATCH: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const id = parseUuidParam(params.id);
  if (!id) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Książka nie istnieje.' });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError({ code: 'VALIDATION_ERROR', status: 400, message: 'Nieprawidłowe ciało żądania.' });
  }

  const parsed = UpdateBookReadSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Nieprawidłowe dane.',
      details: z.flattenError(parsed.error),
    });
  }

  const { data, error } = await locals.supabase
    .from('books')
    .update({ is_read: parsed.data.is_read })
    .eq('id', id)
    .select('id, is_read')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return apiError({ code: 'NOT_FOUND', status: 404, message: 'Książka nie istnieje.' });
    }
    console.error('[api/books PATCH] supabase update failed', {
      name: error.name,
      message: error.message,
      code: error.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się zaktualizować książki.' });
  }

  return apiResponse({ data: { id: data.id, is_read: data.is_read } });
};
