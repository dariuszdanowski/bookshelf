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

  // Tylko obecne pola (undefined pominięte; null = wyczyść). search_text jest
  // GENERATED z (title, authors, publisher) — nie ustawiamy go ręcznie.
  const update: {
    is_read?: boolean;
    cover_url?: string | null;
    user_cover_url?: string | null;
    cover_photo_url?: string | null;
    cover_source?: 'auto' | 'url' | 'photo';
    title?: string;
    authors?: string[];
    publisher?: string | null;
    published_year?: number | null;
    isbn_13?: string | null;
    isbn_10?: string | null;
  } = {};
  const d = parsed.data;
  if (d.is_read !== undefined) update.is_read = d.is_read;
  if (d.cover_url !== undefined) update.cover_url = d.cover_url;
  if (d.user_cover_url !== undefined) update.user_cover_url = d.user_cover_url;
  if (d.cover_photo_url !== undefined) update.cover_photo_url = d.cover_photo_url;
  if (d.cover_source !== undefined) update.cover_source = d.cover_source;
  if (d.title !== undefined) update.title = d.title;
  if (d.authors !== undefined) update.authors = d.authors;
  if (d.publisher !== undefined) update.publisher = d.publisher;
  if (d.published_year !== undefined) update.published_year = d.published_year;
  if (d.isbn_13 !== undefined) update.isbn_13 = d.isbn_13;
  if (d.isbn_10 !== undefined) update.isbn_10 = d.isbn_10;

  const { data, error } = await locals.supabase
    .from('books')
    .update(update)
    .eq('id', id)
    .select('id, is_read, title, authors, publisher, published_year, isbn_13, isbn_10, cover_url, user_cover_url, cover_photo_url, cover_source')
    .single();

  if (error) {
    // 23505 = unique (user_id, isbn_13) — inna książka z tym ISBN już w katalogu.
    if (error.code === '23505') {
      return apiError({ code: 'VALIDATION_ERROR', status: 400, message: 'Masz już książkę z tym ISBN w katalogu.' });
    }
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
      title: data.title,
      authors: data.authors,
      publisher: data.publisher,
      published_year: data.published_year,
      isbn_13: data.isbn_13,
      isbn_10: data.isbn_10,
      cover_url: data.cover_url,
      user_cover_url: data.user_cover_url,
      cover_photo_url: data.cover_photo_url,
      cover_source: data.cover_source,
    },
  });
};

/**
 * DELETE /api/books/:id
 *
 * Usuwa książkę z katalogu. DB-first: kasujemy wiersz `books` (kaskada
 * `shelf_entries.book_id ON DELETE CASCADE` zdejmuje wpis z półki + historię
 * lokalizacji). Zdjęcie, detekcje, book_candidates i vision_runs zostają
 * (brak FK z books) — usuwamy wpis katalogowy, nie historię rozpoznania.
 *
 * Po usunięciu wiersza best-effort czyścimy wgraną okładkę ze Storage
 * (`cover_photo_url`, bucket book-covers). `user_cover_url` to hotlink do
 * zewnętrznego URL — nie nasz obiekt, nie ruszamy. Błąd Storage tylko logujemy
 * (wiersz DB już zniknął → dla usera sukces; ewentualna sierota do batch-cleanu).
 *
 * RLS books_delete_own scope'uje do auth.uid(); pre-check maybeSingle → 404 dla
 * braku rekordu / cudzej książki. parseUuidParam → 404 na zły UUID (privacy-first).
 *
 * 200: { data: { deleted: true } }
 * 404: nie znaleziono / cudza książka / zły UUID
 */
export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const id = parseUuidParam(params.id);
  if (!id) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Książka nie istnieje.' });
  }

  // Pre-check existence + RLS scope; zachowujemy cover_photo_url do czyszczenia Storage.
  const { data: existing, error: selectError } = await locals.supabase
    .from('books')
    .select('id, cover_photo_url')
    .eq('id', id)
    .maybeSingle();

  if (selectError) {
    console.error('[api/books DELETE] pre-check select failed', {
      name: selectError.name,
      message: selectError.message,
      code: selectError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się sprawdzić książki.' });
  }

  if (!existing) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Książka nie istnieje.' });
  }

  const { error: deleteError } = await locals.supabase.from('books').delete().eq('id', id);

  if (deleteError) {
    console.error('[api/books DELETE] supabase delete failed', {
      name: deleteError.name,
      message: deleteError.message,
      code: deleteError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się usunąć książki.' });
  }

  // Best-effort Storage cleanup wgranej okładki — błąd nie zmienia sukcesu.
  // cover_photo_url to publiczny URL: .../object/public/book-covers/{uid}/{plik}.
  if (existing.cover_photo_url) {
    const marker = '/book-covers/';
    const idx = existing.cover_photo_url.indexOf(marker);
    if (idx !== -1) {
      const path = existing.cover_photo_url.slice(idx + marker.length);
      try {
        const { error: rmError } = await locals.supabase.storage.from('book-covers').remove([path]);
        if (rmError) {
          console.error('[api/books DELETE] storage remove failed (orphan left)', {
            name: rmError.name,
            message: rmError.message,
          });
        }
      } catch (err) {
        console.error('[api/books DELETE] storage remove threw (orphan left)', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return apiResponse({ data: { deleted: true } });
};
