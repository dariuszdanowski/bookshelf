import type { APIRoute } from 'astro';
import { z } from 'zod';
import { apiError, apiResponse, parseUuidParam } from '../../../lib/http/response';
import { UpdateBookSchema } from '../../../lib/books/schema';

export const prerender = false;

/**
 * PATCH /api/books/:id
 *
 * Aktualizuje edytowalne pola książki (FR-023 + S-33 override okładki):
 * `is_read` oraz sloty okładki `user_cover_url` / `cover_photo_url` / `cover_source`.
 * Każde pole opcjonalne; `null` w slocie okładki = wyczyść; wymagane ≥1 pole
 * (UpdateBookSchema `.strict()` odrzuca nieznane pola).
 *
 * RLS books_update_own: user może updatować tylko swoje książki;
 * PGRST116 (no rows) → 404 (RLS scope lub brak rekordu).
 *
 * 200: { data: { id, is_read, cover_url, user_cover_url, cover_photo_url, cover_source } }
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

  const parsed = UpdateBookSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Nieprawidłowe dane.',
      details: z.flattenError(parsed.error),
    });
  }

  // Tylko obecne pola (undefined pominięte; null = wyczyść slot).
  const update: {
    is_read?: boolean;
    user_cover_url?: string | null;
    cover_photo_url?: string | null;
    cover_source?: 'auto' | 'url' | 'photo';
  } = {};
  if (parsed.data.is_read !== undefined) update.is_read = parsed.data.is_read;
  if (parsed.data.user_cover_url !== undefined) update.user_cover_url = parsed.data.user_cover_url;
  if (parsed.data.cover_photo_url !== undefined) update.cover_photo_url = parsed.data.cover_photo_url;
  if (parsed.data.cover_source !== undefined) update.cover_source = parsed.data.cover_source;

  const { data, error } = await locals.supabase
    .from('books')
    .update(update)
    .eq('id', id)
    .select('id, is_read, cover_url, user_cover_url, cover_photo_url, cover_source')
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

  return apiResponse({
    data: {
      id: data.id,
      is_read: data.is_read,
      cover_url: data.cover_url,
      user_cover_url: data.user_cover_url,
      cover_photo_url: data.cover_photo_url,
      cover_source: data.cover_source,
    },
  });
};
