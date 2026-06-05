import type { APIRoute } from 'astro';
import { z } from 'zod';

import type { BookCandidate, ScoredCandidate } from '../../../../lib/books/schema';
import { RematchDetectionSchema } from '../../../../lib/books/schema';
import { searchGoogleBooks } from '../../../../lib/books/googleBooks';
import { searchOpenLibrary, searchOpenLibraryByTitle } from '../../../../lib/books/openLibrary';
import { apiError, apiResponse, parseUuidParam } from '../../../../lib/http/response';
import { CONSERVATIVE_REPLACE_MARGIN } from '../../../../lib/matching/fallbackPolicy';
import { checkCatalogDuplicate, dedupeCandidates } from '../../../../lib/matching/dedupe';
import { scoreCandidate } from '../../../../lib/matching/score';
import { extractAuthorFromTitle } from '../../../../lib/matching/normalizeQuery';

export const prerender = false;

// Niższy próg niż MATCH_MID (0.55) — rematch to świadome wyszukiwanie przez usera,
// który i tak wybiera ręcznie. Pozwala na wyniki cross-języka (Keret po polsku vs
// angielskie wpisy GB — author match ~0.30 przechodzi próg 0.25).
const REMATCH_MIN_SCORE = 0.25;
const MAX_CANDIDATES = 8;

type ExistingBook = {
  id: string;
  title: string;
  authors: string[];
  isbn_13: string | null;
  isbn_10: string | null;
};

async function matchOne(
  rawTitle: string,
  rawAuthor: string | null,
  existingBooks: ExistingBook[]
): Promise<{ candidates: ScoredCandidate[]; rateLimited: boolean }> {
  // GB i OL title search równolegle — OL może mieć polskie edycje których nie ma GB.
  const [googleResult, olTitleResult] = await Promise.all([
    searchGoogleBooks({ title: rawTitle, author: rawAuthor }),
    searchOpenLibraryByTitle({ title: rawTitle, author: rawAuthor }),
  ]);

  if (!googleResult.ok && googleResult.reason === 'rate_limited') {
    return { candidates: [], rateLimited: true };
  }

  const allCandidates: BookCandidate[] = [
    ...(googleResult.ok ? googleResult.candidates : []),
    ...(olTitleResult.ok ? olTitleResult.candidates : []),
  ];

  // OL ISBN enrichment z najlepszego kandydata GB
  if (googleResult.ok) {
    const firstIsbn =
      googleResult.candidates.find((c) => c.isbn13)?.isbn13 ??
      googleResult.candidates.find((c) => c.isbn10)?.isbn10 ??
      null;
    if (firstIsbn) {
      const olIsbnResult = await searchOpenLibrary({ title: rawTitle, isbn: firstIsbn });
      if (olIsbnResult.ok) allCandidates.push(...olIsbnResult.candidates);
    }
  }

  if (allCandidates.length === 0) {
    void existingBooks;
    return { candidates: [], rateLimited: false };
  }

  const scored: ScoredCandidate[] = allCandidates.map((c) => ({
    ...c,
    matchScore: scoreCandidate(
      { raw_title: rawTitle, raw_author: rawAuthor },
      { title: c.title, authors: c.authors, isbn13: c.isbn13, isbn10: c.isbn10 }
    ),
  }));

  scored.sort((a, b) => b.matchScore - a.matchScore);
  const candidates = dedupeCandidates(scored.filter((c) => c.matchScore >= REMATCH_MIN_SCORE))
    .slice(0, MAX_CANDIDATES)
    .map((c) => {
      if (c.coverUrl) return c;
      const isbn = c.isbn13 ?? c.isbn10;
      if (!isbn) return c;
      return { ...c, coverUrl: `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false` };
    });

  void existingBooks; // used only for duplicate check downstream
  return { candidates, rateLimited: false };
}

/**
 * POST /api/detections/[id]/rematch
 *
 * Wyszukuje kandydatów Google Books z podanym tytułem i autorem (zamiast raw OCR).
 * Aktualizuje raw_title/raw_author, zastępuje book_candidates, zwraca wyniki z DB ID.
 *
 * Używa konserwatywnej polityki zastępowania: nowe kandydaty zastępują stare tylko gdy
 * nowy top score + CONSERVATIVE_REPLACE_MARGIN >= stary top score.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const detectionId = parseUuidParam(params.id);
  if (!detectionId) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono detekcji.' });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError({ code: 'VALIDATION_ERROR', status: 400, message: 'Nieprawidłowe ciało żądania.' });
  }

  const parsed = RematchDetectionSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Nieprawidłowe dane.',
      details: z.flattenError(parsed.error),
    });
  }

  const { title: rawTitle, author } = parsed.data;
  const rawAuthorFromForm = author ?? null;

  // Auto-extract autora gdy tytuł zawiera wzorzec "Tytuł — Imię Nazwisko"
  // i pole autora jest puste (np. user wkleił pełny opis z grzbietem).
  const extracted = !rawAuthorFromForm ? extractAuthorFromTitle(rawTitle) : null;
  const title = extracted?.title ?? rawTitle;
  const rawAuthor = extracted?.author ?? rawAuthorFromForm;

  const { data: detection, error: detectionError } = await locals.supabase
    .from('detections')
    .select('id, status')
    .eq('id', detectionId)
    .maybeSingle();

  if (detectionError) {
    console.error('[api/detections/rematch POST] detection select failed', {
      name: detectionError.name,
      message: detectionError.message,
      code: detectionError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd pobierania detekcji.' });
  }
  if (!detection) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono detekcji.' });
  }

  const { data: existingCandidateRows, error: existingCandErr } = await locals.supabase
    .from('book_candidates')
    .select('match_score, rank')
    .eq('detection_id', detectionId);

  if (existingCandErr) {
    console.error('[api/detections/rematch POST] existing candidates failed', existingCandErr.message);
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd pobierania kandydatów.' });
  }

  const { data: existingBooks, error: booksError } = await locals.supabase
    .from('books')
    .select('id, title, authors, isbn_13, isbn_10')
    .eq('user_id', locals.user.id);

  if (booksError) {
    console.error('[api/detections/rematch POST] books select failed', booksError.message);
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd pobierania katalogu.' });
  }

  const catalog: ExistingBook[] = (existingBooks ?? []).map((b) => ({
    id: b.id,
    title: b.title,
    authors: b.authors,
    isbn_13: b.isbn_13,
    isbn_10: b.isbn_10,
  }));

  const match = await matchOne(title, rawAuthor, catalog);
  if (match.rateLimited) {
    return apiError({
      code: 'RATE_LIMITED',
      status: 429,
      message: 'Google Books rate limit. Spróbuj ponownie za chwilę.',
    });
  }

  const existingTopScore =
    (existingCandidateRows ?? []).length > 0
      ? Math.max(...(existingCandidateRows ?? []).map((r) => r.match_score ?? 0))
      : null;
  const newTopScore = match.candidates.length > 0 ? match.candidates[0].matchScore : null;

  const shouldReplace =
    existingTopScore == null ||
    (newTopScore != null && newTopScore + CONSERVATIVE_REPLACE_MARGIN >= existingTopScore);

  const finalStatus = match.candidates.length > 0 ? 'matched' : 'pending';

  const { error: updateError } = await locals.supabase
    .from('detections')
    .update({ raw_title: title, raw_author: rawAuthor, status: finalStatus })
    .eq('id', detectionId);

  if (updateError) {
    console.error('[api/detections/rematch POST] detection update failed', updateError.message);
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd aktualizacji detekcji.' });
  }

  if (shouldReplace) {
    const { error: deleteError } = await locals.supabase
      .from('book_candidates')
      .delete()
      .eq('detection_id', detectionId);

    if (deleteError) {
      console.error('[api/detections/rematch POST] candidate delete failed', deleteError.message);
      return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd usuwania kandydatów.' });
    }

    if (match.candidates.length > 0) {
      const { data: inserted, error: insertError } = await locals.supabase
        .from('book_candidates')
        .insert(
          match.candidates.map((c, idx) => ({
            detection_id: detectionId,
            source: c.source,
            external_id: c.externalId,
            title: c.title,
            authors: c.authors,
            isbn_10: c.isbn10,
            isbn_13: c.isbn13,
            publisher: c.publisher,
            published_year: c.publishedYear,
            cover_url: c.coverUrl,
            match_score: c.matchScore,
            rank: idx + 1,
          }))
        )
        .select('id, source, external_id, title, authors, isbn_10, isbn_13, publisher, published_year, cover_url, match_score, rank');

      if (insertError || !inserted) {
        console.error('[api/detections/rematch POST] candidate insert failed', insertError?.message);
        return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd zapisywania kandydatów.' });
      }

      const duplicate = checkCatalogDuplicate(match.candidates[0], catalog);

      return apiResponse({
        data: {
          applied: true,
          detection: { id: detectionId, status: finalStatus, raw_title: title, raw_author: rawAuthor },
          candidates: inserted.map((row) => ({
            id: row.id,
            source: row.source,
            externalId: row.external_id,
            title: row.title,
            authors: row.authors,
            isbn10: row.isbn_10,
            isbn13: row.isbn_13,
            publisher: row.publisher,
            publishedYear: row.published_year,
            coverUrl: row.cover_url,
            matchScore: row.match_score,
            rank: row.rank,
          })),
          duplicate,
        },
      });
    }
  }

  // No candidates found or keeping existing
  return apiResponse({
    data: {
      applied: false,
      detection: { id: detectionId, status: finalStatus, raw_title: title, raw_author: rawAuthor },
      candidates: [],
      duplicate: null,
    },
  });
};
