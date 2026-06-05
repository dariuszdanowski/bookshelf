import type { APIRoute } from 'astro';
import { z } from 'zod';

import { IdentifyBookSchema } from '../../../../lib/books/schema';
import { apiError, apiResponse, parseUuidParam } from '../../../../lib/http/response';
import { findBookCandidates } from '../../../../lib/matching/findCandidates';
import { extractAuthorFromTitle } from '../../../../lib/matching/normalizeQuery';

export const prerender = false;

/**
 * POST /api/books/:id/identify
 *
 * „Szukaj po tytule" / re-identyfikacja zatwierdzonej książki — ta sama funkcja
 * co w propozycjach (GB + OpenLibrary + Biblioteka Narodowa), ale dla istniejącej
 * książki zamiast detekcji.
 *
 * Tryb 'search': { mode, title, author?, isbn? } → { candidates } (bez zapisu).
 * Tryb 'apply':  { mode, candidate } → nadpisuje metadane + okładkę książki
 *                 (cover_source resetowany do 'auto', by nowa okładka była widoczna).
 *
 * 200: { data: { candidates } } | { data: { applied: true, book } }
 * 404: książka nie istnieje / cudza
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
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

  const parsed = IdentifyBookSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Nieprawidłowe dane.',
      details: z.flattenError(parsed.error),
    });
  }

  // Książka istnieje + RLS scope (404 dla cudzej/nieistniejącej).
  const { data: book, error: bookErr } = await locals.supabase
    .from('books')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (bookErr) {
    console.error('[api/books identify] book select failed', { name: bookErr.name, message: bookErr.message, code: bookErr.code });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd serwera.' });
  }
  if (!book) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Książka nie istnieje.' });
  }

  // -------------------------------------------------------------------- SEARCH
  if (parsed.data.mode === 'search') {
    const authorFromForm = parsed.data.author ?? null;
    // Auto-ekstrakcja autora z „Tytuł — Imię Nazwisko" gdy pole autora puste.
    const extracted = !authorFromForm ? extractAuthorFromTitle(parsed.data.title) : null;
    const title = extracted?.title ?? parsed.data.title;
    const author = extracted?.author ?? authorFromForm;

    const result = await findBookCandidates(title, author, parsed.data.isbn?.trim() || null);
    if (result.rateLimited) {
      return apiError({ code: 'RATE_LIMITED', status: 429, message: 'Rate limit. Spróbuj ponownie za chwilę.' });
    }
    return apiResponse({ data: { candidates: result.candidates } });
  }

  // --------------------------------------------------------------------- APPLY
  const c = parsed.data.candidate;
  const { data: updated, error: updateError } = await locals.supabase
    .from('books')
    .update({
      title: c.title,
      authors: c.authors,
      isbn_13: c.isbn13 ?? null,
      isbn_10: c.isbn10 ?? null,
      publisher: c.publisher ?? null,
      published_year: c.publishedYear ?? null,
      cover_url: c.coverUrl ?? null,
      cover_source: 'auto', // nowa okładka z identyfikacji → pokaż automatyczną
      source: c.source ?? null,
      source_external_id: c.externalId ?? null,
    })
    .eq('id', id)
    .select('id, title, authors, isbn_13, isbn_10, publisher, published_year, cover_url, cover_source, user_cover_url, cover_photo_url')
    .single();

  if (updateError) {
    // 23505 = unique (user_id, isbn_13) — książka o tym ISBN już w katalogu.
    if (updateError.code === '23505') {
      return apiError({ code: 'VALIDATION_ERROR', status: 400, message: 'Masz już książkę z tym ISBN w katalogu.' });
    }
    if (updateError.code === 'PGRST116') {
      return apiError({ code: 'NOT_FOUND', status: 404, message: 'Książka nie istnieje.' });
    }
    console.error('[api/books identify] apply update failed', { name: updateError.name, message: updateError.message, code: updateError.code });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się zaktualizować książki.' });
  }

  return apiResponse({ data: { applied: true, book: updated } });
};
