import type { APIRoute } from 'astro';
import { z } from 'zod';
import { apiError, apiResponse, parseUuidParam } from '../../../../lib/http/response';
import { MoveBookSchema } from '../../../../lib/books/schema';

export const prerender = false;

/**
 * POST /api/books/:id/move
 *
 * Przenosi książkę na inną półkę, zapisując wersjonowaną historię lokalizacji
 * (FR-038): INSERT nowego wpisu shelf_entries (is_current=true, pozycja max+1 na
 * półce docelowej) → UPDATE dotychczasowego wpisu na is_current=false.
 *
 * Kolejność insert-first: przy błędzie między zapisami książka jest co najwyżej
 * chwilowo na dwóch półkach (widoczna, naprawialna) — nigdy bez bieżącej półki.
 * Brak rpc/funkcji DB (typ Database.Functions pusty, nieregenerowalny w branchu).
 *
 * Ownership obu zasobów wymuszony przez RLS (shelf_entries oba-FK od migr. 0009);
 * pre-selecty dają czytelne 404. Data zakupu / metadane / is_read żyją na books → nietknięte.
 *
 * 200: { data: { book_id, shelf_id } }
 * 401: niezalogowany
 * 404: zły UUID / książka lub półka docelowa nie istnieje (lub cudza)
 * 400: walidacja Zod
 * 409: książka nie ma bieżącej lokalizacji / już jest na tej półce
 * 500: błąd zapisu
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const bookId = parseUuidParam(params.id);
  if (!bookId) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Książka nie istnieje.' });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError({ code: 'VALIDATION_ERROR', status: 400, message: 'Nieprawidłowe ciało żądania.' });
  }

  const parsed = MoveBookSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Nieprawidłowe dane.',
      details: z.flattenError(parsed.error),
    });
  }
  const targetShelfId = parsed.data.shelf_id;

  // 1. Książka istnieje i należy do usera (RLS-scoped) → 404 wpp.
  const { data: book, error: bookError } = await locals.supabase
    .from('books')
    .select('id')
    .eq('id', bookId)
    .maybeSingle();
  if (bookError) {
    console.error('[api/books move] books select failed', {
      name: bookError.name,
      message: bookError.message,
      code: bookError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd serwera.' });
  }
  if (!book) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Książka nie istnieje.' });
  }

  // 2. Półka docelowa istnieje i należy do usera (RLS-scoped) → 404 wpp.
  const { data: shelf, error: shelfError } = await locals.supabase
    .from('shelves')
    .select('id')
    .eq('id', targetShelfId)
    .maybeSingle();
  if (shelfError) {
    console.error('[api/books move] shelves select failed', {
      name: shelfError.name,
      message: shelfError.message,
      code: shelfError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd serwera.' });
  }
  if (!shelf) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Półka nie istnieje.' });
  }

  // 3. Bieżący wpis książki — potrzebny do wykrycia no-op i do UPDATE-historycznego.
  const { data: currentEntry, error: currentError } = await locals.supabase
    .from('shelf_entries')
    .select('id, shelf_id')
    .eq('book_id', bookId)
    .eq('is_current', true)
    .maybeSingle();
  if (currentError) {
    console.error('[api/books move] current entry select failed', {
      name: currentError.name,
      message: currentError.message,
      code: currentError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd serwera.' });
  }
  if (!currentEntry) {
    return apiError({ code: 'CONFLICT', status: 409, message: 'Książka nie ma bieżącej lokalizacji.' });
  }
  if (currentEntry.shelf_id === targetShelfId) {
    return apiError({ code: 'CONFLICT', status: 409, message: 'Książka już jest na tej półce.' });
  }

  // 4. Pozycja „od lewej" na półce docelowej = max+1 wśród bieżących (wzorzec confirm.ts).
  const { data: maxRow } = await locals.supabase
    .from('shelf_entries')
    .select('position_index')
    .eq('shelf_id', targetShelfId)
    .eq('is_current', true)
    .order('position_index', { ascending: false })
    .limit(1)
    .maybeSingle();
  const positionIndex = (maxRow?.position_index ?? 0) + 1;

  // 5. INSERT nowego bieżącego wpisu (insert-first). Nowa lokalizacja nie pochodzi
  //    ze zdjęcia → photo_id / detection_id NULL.
  const { error: insertError } = await locals.supabase.from('shelf_entries').insert({
    book_id: bookId,
    shelf_id: targetShelfId,
    position_index: positionIndex,
    photo_id: null,
    detection_id: null,
    is_current: true,
  });
  if (insertError) {
    console.error('[api/books move] shelf_entries insert failed', {
      name: insertError.name,
      message: insertError.message,
      code: insertError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się przenieść książki.' });
  }

  // 6. UPDATE dotychczasowego wpisu na historyczny. Jeśli padnie — nowy wpis już
  //    istnieje (książka widoczna na obu półkach, naprawialne); logujemy i zwracamy 500.
  const { error: updateError } = await locals.supabase
    .from('shelf_entries')
    .update({ is_current: false })
    .eq('id', currentEntry.id);
  if (updateError) {
    console.error('[api/books move] historical update failed (book now on two shelves)', {
      name: updateError.name,
      message: updateError.message,
      code: updateError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się przenieść książki.' });
  }

  return apiResponse({ data: { book_id: bookId, shelf_id: targetShelfId } });
};
