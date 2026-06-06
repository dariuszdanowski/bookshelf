import type { APIRoute } from 'astro';
import { z } from 'zod';

import { SearchCandidatesSchema } from '../../../lib/books/schema';
import { apiError, apiResponse } from '../../../lib/http/response';
import { findBookCandidates } from '../../../lib/matching/findCandidates';
import { extractAuthorFromTitle } from '../../../lib/matching/normalizeQuery';

export const prerender = false;

/**
 * POST /api/books/candidates
 *
 * Bezksiążkowe wyszukiwanie kandydatów po częściowych danych (tytuł i/lub autor
 * i/lub ISBN). Read-only — nie zapisuje nic do DB. Służy trybowi add (BookModal
 * mode=add), gdy książka jeszcze nie istnieje i nie ma book id.
 *
 * Odróżnij od sąsiada GET /api/books/search — tamten to pełnotekstowa wyszukiwarka
 * katalogu usera (S-08). Ten endpoint wyszukuje w zewnętrznych źródłach
 * (Google Books / OpenLibrary / Biblioteka Narodowa).
 *
 * Body: { title?, author?, isbn? } — min. tytuł lub ISBN wymagany.
 * 200: { data: { candidates: ScoredCandidate[] } }
 * 400: walidacja
 * 429: rate limited
 */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError({ code: 'VALIDATION_ERROR', status: 400, message: 'Nieprawidłowe ciało żądania.' });
  }

  const parsed = SearchCandidatesSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Nieprawidłowe dane.',
      details: z.flattenError(parsed.error),
    });
  }

  const { title = '', author, isbn } = parsed.data;
  const isbnOnly = !title && !!isbn;

  // Auto-ekstrakcja autora z „Tytuł — Imię Nazwisko" gdy pole autora puste.
  const extracted = !author && title ? extractAuthorFromTitle(title) : null;
  const resolvedTitle = extracted?.title ?? title;
  const resolvedAuthor = extracted?.author ?? (author ?? null);

  const result = await findBookCandidates(
    resolvedTitle,
    resolvedAuthor,
    isbn?.trim() || null,
    { isbnOnly }
  );

  if (result.rateLimited) {
    return apiError({ code: 'RATE_LIMITED', status: 429, message: 'Rate limit. Spróbuj ponownie za chwilę.' });
  }

  return apiResponse({ data: { candidates: result.candidates } });
};
