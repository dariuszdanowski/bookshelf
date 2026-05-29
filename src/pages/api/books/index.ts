import type { APIRoute } from 'astro';
import { z } from 'zod';
import { apiError, apiResponse } from '../../../lib/http/response';
import { AddPurchaseSchema } from '../../../lib/books/schema';
import { getPurchasedShelfId } from '../../../lib/shelves/purchased';

export const prerender = false;

/**
 * POST /api/books
 *
 * Flow B (S-06): ręczny zakup → książka na półce „Zakupione".
 * Nie używa confirmDetectionToCatalog (detection-bound); osobna ścieżka bez zdjęcia.
 *
 * Body: AddPurchaseSchema (title wymagany; purchase_date pominięte → dziś).
 * 201: { data: { book_id, shelf_id } }
 * 409: exact-dup po isbn_13
 * 400: walidacja Zod
 * 500: brak „Zakupione" / błąd zapisu (rollback książki)
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

  const parsed = AddPurchaseSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Nieprawidłowe dane.',
      details: z.flattenError(parsed.error),
    });
  }

  const input = parsed.data;

  // Resolve „Zakupione" (RLS-scoped). Brak = stan nieoczekiwany (signup ją tworzy).
  const shelfId = await getPurchasedShelfId(locals.supabase);
  if (!shelfId) {
    console.error('[api/books POST] Zakupione shelf not found for user', { userId: locals.user.id });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie znaleziono półki „Zakupione".' });
  }

  // Exact-dup pre-check po isbn_13 (gdy podany) → 409 z shelfHint
  if (input.isbn_13) {
    const { data: existing } = await locals.supabase
      .from('books')
      .select('id, shelf_entries(shelves(name))')
      .eq('user_id', locals.user.id)
      .eq('isbn_13', input.isbn_13)
      .maybeSingle();
    if (existing) {
      const entry = (existing.shelf_entries as { shelves: { name: string } | null }[] | null)?.[0];
      const hint = entry?.shelves?.name;
      return apiError({
        code: 'CONFLICT',
        status: 409,
        message: hint ? `Masz już tę książkę w katalogu (półka: ${hint}).` : 'Masz już tę książkę w katalogu.',
      });
    }
  }

  const purchaseDate = input.purchase_date ?? new Date().toISOString().slice(0, 10);

  // INSERT books
  const { data: newBook, error: bookError } = await locals.supabase
    .from('books')
    .insert({
      user_id: locals.user.id,
      title: input.title,
      authors: input.authors ?? [],
      publisher: input.publisher ?? null,
      published_year: input.published_year ?? null,
      isbn_13: input.isbn_13 ?? null,
      isbn_10: input.isbn_10 ?? null,
      purchase_date: purchaseDate,
      source: 'manual',
    })
    .select('id')
    .single();

  if (bookError) {
    if (bookError.code === '23505') {
      return apiError({ code: 'CONFLICT', status: 409, message: 'Masz już tę książkę w katalogu.' });
    }
    console.error('[api/books POST] books insert failed', {
      name: bookError.name,
      message: bookError.message,
      code: bookError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się dodać książki.' });
  }

  const bookId = newBook.id;

  // position_index = max+1 na „Zakupione"
  const { data: maxRow } = await locals.supabase
    .from('shelf_entries')
    .select('position_index')
    .eq('shelf_id', shelfId)
    .eq('is_current', true)
    .order('position_index', { ascending: false })
    .limit(1)
    .maybeSingle();
  const positionIndex = (maxRow?.position_index ?? 0) + 1;

  // INSERT shelf_entries — bez transakcji, więc rollback książki przy porażce
  const { error: entryError } = await locals.supabase.from('shelf_entries').insert({
    book_id: bookId,
    shelf_id: shelfId,
    position_index: positionIndex,
    photo_id: null,
    detection_id: null,
    is_current: true,
  });

  if (entryError) {
    console.error('[api/books POST] shelf_entries insert failed — rolling back book', {
      name: entryError.name,
      message: entryError.message,
      code: entryError.code,
    });
    await locals.supabase.from('books').delete().eq('id', bookId);
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się dodać książki na półkę.' });
  }

  return apiResponse({ data: { book_id: bookId, shelf_id: shelfId }, status: 201 });
};
