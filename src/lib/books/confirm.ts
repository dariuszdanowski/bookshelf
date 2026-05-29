import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../db/database.types';

type Supabase = SupabaseClient<Database>;

export type ConfirmBookInput = {
  title: string;
  authors: string[];
  isbn_10: string | null;
  isbn_13: string | null;
  publisher: string | null;
  published_year: number | null;
  cover_url: string | null;
  source: string | null;
  source_external_id: string | null;
};

export type ConfirmDetectionArgs = {
  detection: {
    id: string;
    status: string;
    photo_id: string;
    position_index: number | null;
    raw_title: string | null;
  };
  shelfId: string;
  book: ConfirmBookInput;
  correctionType: 'accept' | 'field_edit' | 'manual_entry';
  /** Filled for field_edit — logged to corrections */
  correctedFields?: {
    title?: string;
    authors?: string[];
  };
};

export type ConfirmResult =
  | { ok: true; bookId: string }
  | { ok: false; reason: 'duplicate'; shelfHint?: string }
  | { ok: false; reason: 'already_confirmed' };

/**
 * Jedna ścieżka detekcja → katalog.
 *
 * Kolejność (bez transakcji — każdy krok bezpieczny do retry):
 *   0. Guard idempotencji: detection.status === 'confirmed' → already_confirmed
 *   1. Pre-check exact-dup po isbn_13 w katalogu usera → duplicate
 *   2. INSERT books (23505 jako backstop → duplicate)
 *   3. INSERT shelf_entries (position z detection, max+1 przy null)
 *   4. UPDATE detections.status = 'confirmed'
 *   5. INSERT corrections (telemetria)
 */
export async function confirmDetectionToCatalog(
  supabase: Supabase,
  userId: string,
  args: ConfirmDetectionArgs
): Promise<ConfirmResult> {
  const { detection, shelfId, book, correctionType, correctedFields } = args;

  // 0. Guard idempotencji
  if (detection.status === 'confirmed') {
    return { ok: false, reason: 'already_confirmed' };
  }

  // 1. Pre-check exact-dup (isbn_13 w katalogu usera)
  if (book.isbn_13) {
    const { data: existing } = await supabase
      .from('books')
      .select('id, shelf_entries(shelf_id, shelves(name))')
      .eq('user_id', userId)
      .eq('isbn_13', book.isbn_13)
      .maybeSingle();

    if (existing) {
      // Próbujemy wyciągnąć nazwę półki dla shelfHint
      const entry = (existing.shelf_entries as { shelf_id: string; shelves: { name: string } | null }[] | null)?.[0];
      const shelfHint = entry?.shelves?.name ?? undefined;
      return { ok: false, reason: 'duplicate', shelfHint };
    }
  }

  // 2. INSERT books
  const { data: newBook, error: bookError } = await supabase
    .from('books')
    .insert({
      user_id: userId,
      title: book.title,
      authors: book.authors,
      isbn_10: book.isbn_10,
      isbn_13: book.isbn_13,
      publisher: book.publisher,
      published_year: book.published_year,
      cover_url: book.cover_url,
      source: book.source,
      source_external_id: book.source_external_id,
    })
    .select('id')
    .single();

  if (bookError) {
    if (bookError.code === '23505') {
      // Unique backstop (isbn_13) — rare race, traktujemy jak dup
      return { ok: false, reason: 'duplicate' };
    }
    throw bookError;
  }

  const bookId = newBook.id;

  // 3. INSERT shelf_entries — position z detekcji lub max+1
  let positionIndex = detection.position_index;
  if (positionIndex === null) {
    const { data: maxRow } = await supabase
      .from('shelf_entries')
      .select('position_index')
      .eq('shelf_id', shelfId)
      .eq('is_current', true)
      .order('position_index', { ascending: false })
      .limit(1)
      .maybeSingle();
    positionIndex = (maxRow?.position_index ?? 0) + 1;
  }

  await supabase.from('shelf_entries').insert({
    book_id: bookId,
    shelf_id: shelfId,
    position_index: positionIndex,
    photo_id: detection.photo_id,
    detection_id: detection.id,
    is_current: true,
  });

  // 4. UPDATE detections.status = 'confirmed'
  await supabase.from('detections').update({ status: 'confirmed' }).eq('id', detection.id);

  // 5. INSERT corrections (telemetria)
  await supabase.from('corrections').insert({
    user_id: userId,
    detection_id: detection.id,
    original_raw_title: detection.raw_title,
    corrected_title: correctedFields?.title ?? null,
    corrected_authors: correctedFields?.authors ?? null,
    correction_type: correctionType,
  });

  return { ok: true, bookId };
}
