import type { APIRoute } from 'astro';

import { findCoverByIsbn } from '../../../../lib/books/cover';
import { apiError, apiResponse, parseUuidParam } from '../../../../lib/http/response';

export const prerender = false;

/**
 * POST /api/photos/[id]/enrich-covers
 *
 * Dociąga okładki dla rank=1 kandydatów tej fotografii, które mają spekulatywny
 * URL (covers.openlibrary.org …-M.jpg?default=false) lub null przy istniejącym ISBN.
 * Przetwarza kolejno (w pętli) żeby nie przekroczyć limitu 30s CF Worker.
 *
 * Odpowiedź: { data: { enriched: [{detectionId, coverUrl}] } }
 * Klient (DetectionReview) odpala po załadowaniu detekcji — bez blokowania UI.
 */
export const POST: APIRoute = async ({ params, locals }) => {
  const id = parseUuidParam(params.id);
  if (!id) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Not found.' });
  }

  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  // Weryfikacja własności zdjęcia przez RLS
  const { error: photoError } = await locals.supabase
    .from('photos')
    .select('id')
    .eq('id', id)
    .single();

  if (photoError) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Not found.' });
  }

  // Ostatni succeeded vision_run dla zdjęcia
  const { data: latestRun } = await locals.supabase
    .from('vision_runs')
    .select('id')
    .eq('photo_id', id)
    .eq('status', 'succeeded')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestRun) {
    return apiResponse({ data: { enriched: [] } });
  }

  // detection_id-y z tego vision_run (nie odrzucone)
  const { data: detectionRows } = await locals.supabase
    .from('detections')
    .select('id')
    .eq('vision_run_id', latestRun.id)
    .neq('status', 'rejected');

  if (!detectionRows?.length) {
    return apiResponse({ data: { enriched: [] } });
  }

  const detectionIds = detectionRows.map((d) => d.id);

  // Rank=1 kandydaci z ISBN, którzy mają null lub spekulatywny URL (-M.jpg?default=false)
  const { data: candidateRows } = await locals.supabase
    .from('book_candidates')
    .select('id, detection_id, title, isbn_13, isbn_10, cover_url')
    .in('detection_id', detectionIds)
    .eq('rank', 1);

  const toEnrich = (candidateRows ?? []).filter(
    (c) => (c.isbn_13 || c.isbn_10) && (!c.cover_url || c.cover_url.includes('?default=false')),
  );

  const enriched: { detectionId: string; coverUrl: string }[] = [];

  // Pętla sekwencyjna — unikamy równoległych HEAD requestów (30s limit CF Worker)
  for (const c of toEnrich) {
    const isbn = c.isbn_13 ?? c.isbn_10;
    if (!isbn) continue;

    let coverUrl: string | null = null;
    try {
      coverUrl = await findCoverByIsbn(isbn, c.title ?? undefined);
    } catch {
      continue; // błąd sieci — pomijamy, nie psujemy całej pętli
    }

    // Aktualizuj w DB tylko gdy znaleziono i URL się zmienił
    if (!coverUrl || coverUrl === c.cover_url) continue;

    const { error: updateError } = await locals.supabase
      .from('book_candidates')
      .update({ cover_url: coverUrl })
      .eq('id', c.id);

    if (updateError) {
      console.error('[enrich-covers] update failed', {
        candidateId: c.id,
        message: updateError.message,
      });
      continue;
    }

    enriched.push({ detectionId: c.detection_id, coverUrl });
  }

  return apiResponse({ data: { enriched } });
};
