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

  // Normalizuj (strip myślników/spacji, uppercase dla 'X' w ISBN-10), potem waliduj
  // formatem spójnym ze schema.ts (ISBN-13 = 13 cyfr, ISBN-10 = 9 cyfr + cyfra/X) —
  // length-only check przepuszczał śmieci typu "...//.." do interpolacji w URL.
  const isbn = (url.searchParams.get('isbn')?.trim() ?? '').replace(/[-\s]/g, '').toUpperCase();
  if (!/^(\d{13}|\d{9}[\dX])$/.test(isbn)) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Podaj poprawny ISBN (10 lub 13 cyfr).',
    });
  }

  const title = url.searchParams.get('title')?.trim() || undefined;
  const cover_url = await findCoverByIsbn(isbn, title);
  return apiResponse({ data: { cover_url } });
};
