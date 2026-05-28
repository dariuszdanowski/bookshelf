import type { APIRoute } from 'astro';

import { apiError, apiResponse, parseUuidParam } from '../../../../lib/http/response';
import { searchGoogleBooks } from '../../../../lib/books/googleBooks';
import { searchOpenLibrary } from '../../../../lib/books/openLibrary';
import { scoreCandidate } from '../../../../lib/matching/score';
import { dedupeCandidates, checkCatalogDuplicate, type CatalogDuplicate } from '../../../../lib/matching/dedupe';
import type { BookCandidate, ScoredCandidate } from '../../../../lib/books/schema';

export const prerender = false;

const MAX_CANDIDATES = 5;

type DetectionRow = {
  id: string;
  raw_title: string | null;
  raw_author: string | null;
  status: string;
  position_index: number;
};

type ExistingBook = {
  id: string;
  title: string;
  authors: string[];
  isbn_13: string | null;
  isbn_10: string | null;
};

type MatchResult = {
  candidates: ScoredCandidate[];
  duplicate: CatalogDuplicate;
  rateLimited: boolean;
};

async function matchDetection(
  detection: DetectionRow,
  existingBooks: ExistingBook[]
): Promise<MatchResult> {
  const rawTitle = detection.raw_title ?? '';
  const rawAuthor = detection.raw_author ?? null;

  const googleResult = await searchGoogleBooks({ title: rawTitle, author: rawAuthor });

  if (!googleResult.ok) {
    return { candidates: [], duplicate: null, rateLimited: googleResult.reason === 'rate_limited' };
  }

  const allCandidates: BookCandidate[] = [...googleResult.candidates];

  // OL ISBN-enrichment: only when ISBN available from Google candidates
  const firstIsbn =
    googleResult.candidates.find((c) => c.isbn13)?.isbn13 ??
    googleResult.candidates.find((c) => c.isbn10)?.isbn10 ??
    null;

  if (firstIsbn) {
    const olResult = await searchOpenLibrary({ title: rawTitle, isbn: firstIsbn });
    if (olResult.ok) allCandidates.push(...olResult.candidates);
  }

  const detForScore = { raw_title: rawTitle, raw_author: rawAuthor };
  const scored: ScoredCandidate[] = allCandidates.map((c) => ({
    ...c,
    matchScore: scoreCandidate(detForScore, {
      title: c.title,
      authors: c.authors,
      isbn13: c.isbn13,
      isbn10: c.isbn10,
    }),
  }));

  const topCandidates = dedupeCandidates(scored).slice(0, MAX_CANDIDATES);
  const duplicate = topCandidates.length > 0
    ? checkCatalogDuplicate(topCandidates[0], existingBooks)
    : null;

  return { candidates: topCandidates, duplicate, rateLimited: false };
}

/**
 * POST /api/photos/[id]/match
 *
 * Parallel matching for all non-rejected detections of a photo:
 * Google primary (cascade) → OL ISBN-enrichment → score → dedupe → persist.
 *
 * Idempotent: delete-then-insert per detection_id.
 * Graceful degrade: Promise.allSettled — failed detection stays at current status.
 * RATE_LIMITED (429) only when ALL detections failed with rate_limited.
 */
export const POST: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const id = parseUuidParam(params.id);
  if (!id) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Not found.' });
  }

  // Verify photo ownership via RLS (PGRST116 if not found / wrong user)
  const { error: photoError } = await locals.supabase
    .from('photos')
    .select('id')
    .eq('id', id)
    .single();

  if (photoError) {
    if (photoError.code === 'PGRST116') {
      return apiError({ code: 'NOT_FOUND', status: 404, message: 'Not found.' });
    }
    console.error('[api/photos/match POST] photo select failed', {
      name: photoError.name,
      message: photoError.message,
      code: photoError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się pobrać zdjęcia.' });
  }

  // Latest succeeded vision_run for this photo
  const { data: latestRun, error: runError } = await locals.supabase
    .from('vision_runs')
    .select('id')
    .eq('photo_id', id)
    .eq('status', 'succeeded')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (runError) {
    console.error('[api/photos/match POST] vision_runs select failed', {
      name: runError.name,
      message: runError.message,
      code: runError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się pobrać vision run.' });
  }

  if (!latestRun) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Brak zakończonego vision run dla tego zdjęcia.' });
  }

  // Non-rejected detections from the latest succeeded run only
  const { data: detectionRows, error: detError } = await locals.supabase
    .from('detections')
    .select('id, raw_title, raw_author, status, position_index')
    .eq('vision_run_id', latestRun.id)
    .neq('status', 'rejected');

  if (detError) {
    console.error('[api/photos/match POST] detections select failed', {
      name: detError.name,
      message: detError.message,
      code: detError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się pobrać detekcji.' });
  }

  if (!detectionRows || detectionRows.length === 0) {
    return apiResponse({ data: { matched: 0, detections: [] } });
  }

  // One query for all user's books — passed to checkCatalogDuplicate per detection
  const { data: existingBooks, error: booksError } = await locals.supabase
    .from('books')
    .select('id, title, authors, isbn_13, isbn_10')
    .eq('user_id', locals.user.id);

  if (booksError) {
    console.error('[api/photos/match POST] books select failed', {
      name: booksError.name,
      message: booksError.message,
      code: booksError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się pobrać katalogu.' });
  }

  const catalog: ExistingBook[] = (existingBooks ?? []).map((b) => ({
    id: b.id,
    title: b.title,
    authors: b.authors,
    isbn_13: b.isbn_13,
    isbn_10: b.isbn_10,
  }));

  // Parallel matching — await fetch ≈ 0 CPU in CF Workers
  const matchResults = await Promise.allSettled(
    detectionRows.map((det) => matchDetection(det, catalog))
  );

  let matchedCount = 0;
  let allRateLimited = true;

  type DetectionResponseItem = {
    id: string;
    raw_title: string;
    raw_author: string | null;
    position_index: number;
    status: string;
    candidates: Array<{
      source: string;
      externalId: string;
      title: string;
      authors: string[];
      isbn10: string | null;
      isbn13: string | null;
      publisher: string | null;
      publishedYear: number | null;
      coverUrl: string | null;
      matchScore: number;
      rank: number;
    }>;
    duplicate: CatalogDuplicate;
  };

  const responseDetections: DetectionResponseItem[] = [];

  for (let i = 0; i < detectionRows.length; i++) {
    const det = detectionRows[i];
    const result = matchResults[i];

    if (result.status === 'rejected') {
      allRateLimited = false;
      responseDetections.push({
        id: det.id,
        raw_title: det.raw_title ?? '',
        raw_author: det.raw_author,
        position_index: det.position_index,
        status: det.status,
        candidates: [],
        duplicate: null,
      });
      continue;
    }

    const { candidates, duplicate, rateLimited } = result.value;
    if (!rateLimited) allRateLimited = false;

    // Rate-limited → leave detection at current status (retriable)
    if (rateLimited) {
      responseDetections.push({
        id: det.id,
        raw_title: det.raw_title ?? '',
        raw_author: det.raw_author,
        position_index: det.position_index,
        status: det.status,
        candidates: [],
        duplicate: null,
      });
      continue;
    }

    // Idempotent persist: delete then insert
    await locals.supabase.from('book_candidates').delete().eq('detection_id', det.id);

    if (candidates.length > 0) {
      const rows = candidates.map((c, idx) => ({
        detection_id: det.id,
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
      }));

      const { error: insertError } = await locals.supabase.from('book_candidates').insert(rows);

      if (insertError) {
        console.error('[api/photos/match POST] book_candidates insert failed', {
          name: insertError.name,
          message: insertError.message,
          code: insertError.code,
          detection_id: det.id,
        });
        responseDetections.push({
          id: det.id,
          raw_title: det.raw_title ?? '',
          raw_author: det.raw_author,
          position_index: det.position_index,
          status: det.status,
          candidates: [],
          duplicate: null,
        });
        continue;
      }
    }

    await locals.supabase.from('detections').update({ status: 'matched' }).eq('id', det.id);
    matchedCount++;

    responseDetections.push({
      id: det.id,
      raw_title: det.raw_title ?? '',
      raw_author: det.raw_author,
      position_index: det.position_index,
      status: 'matched',
      candidates: candidates.map((c, idx) => ({
        source: c.source,
        externalId: c.externalId,
        title: c.title,
        authors: c.authors,
        isbn10: c.isbn10,
        isbn13: c.isbn13,
        publisher: c.publisher,
        publishedYear: c.publishedYear,
        coverUrl: c.coverUrl,
        matchScore: c.matchScore,
        rank: idx + 1,
      })),
      duplicate,
    });
  }

  // Return 429 only when every detection failed with rate_limited
  if (detectionRows.length > 0 && allRateLimited && matchedCount === 0) {
    return apiError({
      code: 'RATE_LIMITED',
      status: 429,
      message: 'Google Books rate limit. Spróbuj ponownie za chwilę.',
    });
  }

  return apiResponse({ data: { matched: matchedCount, detections: responseDetections } });
};
