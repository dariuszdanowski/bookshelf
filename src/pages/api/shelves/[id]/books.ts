import type { APIRoute } from 'astro';
import { apiError, apiResponse, parseUuidParam } from '../../../../lib/http/response';
import type { ShelfBookDTO } from '../../../../lib/books/schema';

export const prerender = false;

/**
 * GET /api/shelves/:id/books
 *
 * Zwraca książki na danej półce w kolejności „od lewej" (position_index ASC).
 * Używane przez ShelfBooksIsland w widoku półki (FR-024).
 *
 * RLS shelf_entries via books.user_id — join przez is_current=true.
 * Własność półki weryfikowana przez zapytanie RLS-scoped na shelves.
 *
 * 200: { data: { books: ShelfBookDTO[] } }
 * 404: półka nie istnieje / cudza
 */
export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const shelfId = parseUuidParam(params.id);
  if (!shelfId) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Półka nie istnieje.' });
  }

  // Sprawdź własność półki (RLS scoped — cudza → no rows)
  const { data: shelf, error: shelfError } = await locals.supabase
    .from('shelves')
    .select('id')
    .eq('id', shelfId)
    .maybeSingle();

  if (shelfError) {
    console.error('[api/shelves/books GET] shelves select failed', {
      name: shelfError.name,
      message: shelfError.message,
      code: shelfError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd serwera.' });
  }
  if (!shelf) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Półka nie istnieje.' });
  }

  // Join shelf_entries → books; is_current=true; order position_index ASC nulls last
  const { data: rows, error } = await locals.supabase
    .from('shelf_entries')
    .select('position_index, photo_id, books(id, title, authors, cover_url, published_year, is_read, isbn_13, isbn_10, publisher)')
    .eq('shelf_id', shelfId)
    .eq('is_current', true)
    .order('position_index', { ascending: true, nullsFirst: false });

  if (error) {
    console.error('[api/shelves/books GET] shelf_entries select failed', {
      name: error.name,
      message: error.message,
      code: error.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się pobrać książek.' });
  }

  const books: ShelfBookDTO[] = (rows ?? [])
    .filter((row) => row.books != null)
    .map((row) => {
      const b = row.books as {
        id: string;
        title: string;
        authors: string[];
        cover_url: string | null;
        published_year: number | null;
        is_read: boolean;
        isbn_13: string | null;
        isbn_10: string | null;
        publisher: string | null;
      };
      return {
        id: b.id,
        title: b.title,
        authors: b.authors,
        cover_url: b.cover_url,
        published_year: b.published_year,
        position_index: row.position_index,
        is_read: b.is_read,
        photo_id: row.photo_id,
        isbn_13: b.isbn_13,
        isbn_10: b.isbn_10,
        publisher: b.publisher,
      };
    });

  return apiResponse({ data: { books } });
};
