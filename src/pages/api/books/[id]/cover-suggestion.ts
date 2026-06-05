import type { APIRoute } from 'astro';
import { apiError, apiResponse, parseUuidParam } from '../../../../lib/http/response';
import { searchGoogleBooks } from '../../../../lib/books/googleBooks';

export const prerender = false;

/**
 * GET /api/books/:id/cover-suggestion
 *
 * „Sprawdź okładkę automatycznie" (S-33): szuka okładki po ISBN książki w darmowych
 * źródłach (OpenLibrary covers + Google Books). Pierwsza dostępna → zapisuje do
 * `books.cover_url` (slot automatyczny) i zwraca. Brak → `{ cover_url: null }`.
 *
 * Ratuje przypadki gdy w momencie matchu okładki nie było, a źródło dodało ją później.
 *
 * 200: { data: { cover_url: string | null } }
 * 404: nie znaleziono / cudza książka
 */
export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const id = parseUuidParam(params.id);
  if (!id) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Książka nie istnieje.' });
  }

  const { data: book, error } = await locals.supabase
    .from('books')
    .select('id, title, isbn_13, isbn_10')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[api/books cover-suggestion] book select failed', {
      name: error.name,
      message: error.message,
      code: error.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd serwera.' });
  }
  if (!book) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Książka nie istnieje.' });
  }

  const isbn = book.isbn_13 ?? book.isbn_10 ?? null;
  if (!isbn) {
    return apiResponse({ data: { cover_url: null } });
  }

  let found: string | null = null;

  // 1. OpenLibrary covers po ISBN — default=false → 404 gdy brak okładki.
  const olUrl = `https://covers.openlibrary.org/b/isbn/${isbn.replace(/[-\s]/g, '')}-L.jpg?default=false`;
  try {
    const head = await fetch(olUrl, { method: 'HEAD' });
    if (head.ok) found = olUrl;
  } catch {
    // sieć — pomiń, spróbuj GB
  }

  // 2. Google Books po ISBN (gdy OL nie ma) — imageLinks.thumbnail.
  if (!found) {
    const gb = await searchGoogleBooks({ title: book.title, isbn });
    if (gb.ok) {
      found = gb.candidates.find((c) => c.coverUrl)?.coverUrl ?? null;
    }
  }

  if (!found) {
    return apiResponse({ data: { cover_url: null } });
  }

  const { error: updateError } = await locals.supabase
    .from('books')
    .update({ cover_url: found })
    .eq('id', id);

  if (updateError) {
    console.error('[api/books cover-suggestion] update failed', {
      name: updateError.name,
      message: updateError.message,
      code: updateError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się zapisać okładki.' });
  }

  return apiResponse({ data: { cover_url: found } });
};
