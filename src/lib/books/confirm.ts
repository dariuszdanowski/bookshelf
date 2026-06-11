import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../db/database.types';

export type UnconfirmResult =
  | { ok: true; status: 'matched' | 'pending' }
  | { ok: false; reason: 'not_confirmed' | 'not_found' };

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
  /** Dominujący kolor grzbietu z detekcji (S-08 filtr); null dla manual/Flow-B. */
  spine_color: string | null;
  /** Krótki opis z kandydata (S-17) → books.description → search_text; null dla manual. */
  description: string | null;
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
  | { ok: false; reason: 'already_confirmed' }
  | { ok: false; reason: 'write_failed' };

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
  args: ConfirmDetectionArgs,
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
      const entry = (
        existing.shelf_entries as { shelf_id: string; shelves: { name: string } | null }[] | null
      )?.[0];
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
      spine_color: book.spine_color,
      description: book.description,
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

  const { error: entryError } = await supabase.from('shelf_entries').insert({
    book_id: bookId,
    shelf_id: shelfId,
    position_index: positionIndex,
    photo_id: detection.photo_id,
    detection_id: detection.id,
    is_current: true,
  });

  // Brak transakcji w PostgREST: jeśli shelf_entries padnie, książka zostałaby
  // sierotą w katalogu (niewidoczna w /books, ale blokująca re-add przez dup
  // pre-check). Best-effort rollback — kasujemy świeżo utworzoną książkę i
  // zwracamy błąd zapisu, żeby endpoint nie raportował fałszywego sukcesu.
  if (entryError) {
    console.error('[confirm] shelf_entries insert failed — rolling back book', {
      name: entryError.name,
      message: entryError.message,
      code: entryError.code,
    });
    await supabase.from('books').delete().eq('id', bookId);
    return { ok: false, reason: 'write_failed' };
  }

  // 4. UPDATE detections.status = 'confirmed'
  // Jeśli to padnie, guard idempotencji nie zadziała przy retry → ryzyko
  // duplikatu dla książek bez ISBN. Logujemy żeby było diagnozowalne.
  const { error: statusError } = await supabase
    .from('detections')
    .update({ status: 'confirmed' })
    .eq('id', detection.id);
  if (statusError) {
    console.error('[confirm] detections status update failed', {
      name: statusError.name,
      message: statusError.message,
      code: statusError.code,
    });
  }

  // 5. INSERT corrections (telemetria) — porażka tu nie wpływa na katalog
  const { error: correctionError } = await supabase.from('corrections').insert({
    user_id: userId,
    detection_id: detection.id,
    original_raw_title: detection.raw_title,
    corrected_title: correctedFields?.title ?? null,
    corrected_authors: correctedFields?.authors ?? null,
    correction_type: correctionType,
  });
  if (correctionError) {
    console.error('[confirm] corrections insert failed (telemetria)', {
      name: correctionError.name,
      message: correctionError.message,
      code: correctionError.code,
    });
  }

  return { ok: true, bookId };
}

/**
 * Odwrócenie confirmDetectionToCatalog — usuwa wpis katalogowy i przywraca
 * detekcję do edycji. Symetria do unreject.ts.
 *
 * Kroki (bez transakcji — każdy krok retry-safe):
 *   0. SELECT detection id,status → not_found / not_confirmed
 *   1. SELECT shelf_entries WHERE detection_id → zbierz book_ids
 *   2. DELETE shelf_entries WHERE detection_id (RLS: books.user_id check)
 *   3. Dla każdego book_id: count pozostałych entries → gdy 0 DELETE books
 *   4. count book_candidates → UPDATE detections.status = matched/pending
 *   5. best-effort DELETE corrections (accept/field_edit/manual_entry)
 */
export async function unconfirmDetectionFromCatalog(
  supabase: Supabase,
  _userId: string,
  detectionId: string,
): Promise<UnconfirmResult> {
  // 0. Guard: detection musi istnieć i mieć status 'confirmed'
  const { data: detection, error: detError } = await supabase
    .from('detections')
    .select('id, status')
    .eq('id', detectionId)
    .maybeSingle();

  if (detError) throw detError;
  if (!detection) return { ok: false, reason: 'not_found' };
  if (detection.status !== 'confirmed') return { ok: false, reason: 'not_confirmed' };

  // 1. Zbierz book_ids powiązane przez detection_id (bez filtra is_current — S-15 może togglować flagę)
  const { data: entries, error: entriesSelectError } = await supabase
    .from('shelf_entries')
    .select('book_id')
    .eq('detection_id', detectionId);

  if (entriesSelectError) throw entriesSelectError;
  const bookIds = (entries ?? []).map((e) => e.book_id);

  // 2. DELETE shelf_entries WHERE detection_id (najpierw — RLS shelf_entries_delete_own sprawdza books.user_id)
  const { error: entriesDeleteError } = await supabase
    .from('shelf_entries')
    .delete()
    .eq('detection_id', detectionId);

  if (entriesDeleteError) throw entriesDeleteError;

  // 3. Orphan-safety: kasuj książkę tylko gdy nie ma już żadnego shelf_entry
  for (const bookId of bookIds) {
    const { count, error: countError } = await supabase
      .from('shelf_entries')
      .select('id', { count: 'exact', head: true })
      .eq('book_id', bookId);

    if (countError) throw countError;
    if ((count ?? 0) === 0) {
      await supabase.from('books').delete().eq('id', bookId);
    }
  }

  // 4. Status docelowy: matched gdy są kandydaci, pending gdy nie ma
  const { count: candidateCount, error: candidateCountError } = await supabase
    .from('book_candidates')
    .select('id', { count: 'exact', head: true })
    .eq('detection_id', detectionId);

  if (candidateCountError) throw candidateCountError;
  const nextStatus = (candidateCount ?? 0) > 0 ? 'matched' : 'pending';

  const { error: updateError } = await supabase
    .from('detections')
    .update({ status: nextStatus })
    .eq('id', detectionId);

  if (updateError) throw updateError;

  // 5. best-effort DELETE corrections telemetrii akceptacji (cofnięte ≠ realne)
  await supabase
    .from('corrections')
    .delete()
    .eq('detection_id', detectionId)
    .in('correction_type', ['accept', 'field_edit', 'manual_entry']);

  return { ok: true, status: nextStatus };
}
