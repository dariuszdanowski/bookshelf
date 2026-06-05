import type { APIRoute } from 'astro';
import { findCoverByIsbn } from '../../../lib/books/cover';
import { apiError, apiResponse } from '../../../lib/http/response';

export const prerender = false;

/**
 * GET /api/books/cover-suggestion?isbn=<isbn>
 *
 * Book-less lookup okładki po ISBN — read-only (bez DB-write). Używany w trybie
 * add (BookModal mode=add), gdy książka jeszcze nie istnieje i brak book id.
 * Podstawia URL w slocie okładki po stronie klienta.
 *
 * Odróżnij od sąsiada GET /api/books/:id/cover-suggestion — tamten jest id-keyed,
 * zapisuje cover_url do wiersza books i służy trybowi edit (istniejąca książka).
 *
 * 200: { data: { cover_url: string | null } }
 * 400: brak lub zły ISBN
 * 401: brak autoryzacji
 */
export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const isbn = url.searchParams.get('isbn')?.trim() ?? '';
  if (!isbn || isbn.length < 10 || isbn.length > 20) {
    return apiError({ code: 'VALIDATION_ERROR', status: 400, message: 'Podaj poprawny ISBN (10 lub 13 cyfr).' });
  }

  const cover_url = await findCoverByIsbn(isbn);
  return apiResponse({ data: { cover_url } });
};
