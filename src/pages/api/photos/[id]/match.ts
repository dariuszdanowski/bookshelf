import type { APIRoute } from 'astro';

import { apiError, apiResponse, parseUuidParam } from '../../../../lib/http/response';
import { searchGoogleBooks } from '../../../../lib/books/googleBooks';
import { searchOpenLibrary } from '../../../../lib/books/openLibrary';
import { scoreCandidate, MATCH_MID } from '../../../../lib/matching/score';
import { dedupeCandidates, checkCatalogDuplicate, type CatalogDuplicate } from '../../../../lib/matching/dedupe';
import type { BookCandidate, ScoredCandidate } from '../../../../lib/books/schema';
import { CONSERVATIVE_REPLACE_MARGIN } from '../../../../lib/matching/fallbackPolicy';

export const prerender = false;

const MAX_CANDIDATES = 5;
// Google Books QPS limit: even with API key, 35 simultaneous requests cause 429s.
// Limit concurrency to avoid request storms on larger shelves.
const MATCH_CONCURRENCY = 5;

/**
 * Runs tasks with a bounded concurrency pool — no external dependency needed.
 * Preserves original order and returns the same PromiseSettledResult[] shape
 * as Promise.allSettled so callers are interchangeable.
 */
async function settledWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;

  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      try {
        results[i] = { status: 'fulfilled', value: await tasks[i]() };
      } catch (e) {
        results[i] = { status: 'rejected', reason: e };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

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

type ExistingCandidateRow = {
  detection_id: string;
  source: string;
  external_id: string;
  title: string;
  authors: string[];
  isbn_10: string | null;
  isbn_13: string | null;
  publisher: string | null;
  published_year: number | null;
  cover_url: string | null;
  match_score: number;
  rank: number;
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

  // Próg jakości: kandydaci poniżej MATCH_MID (0.55) to "brak pewnego matchu"
  // (PRD §10 + CLAUDE.md). Odrzucamy ich, by detekcja pokazała ścieżkę
  // "Wpisz ręcznie" zamiast fałszywej propozycji (np. antologia 48%, śmieci 25%).
  // Filtr PRZED dedupe/slice — inaczej top-5 zapełniłyby się szumem.
  const aboveThreshold = scored.filter((c) => c.matchScore >= MATCH_MID);
  const deduped = dedupeCandidates(aboveThreshold).slice(0, MAX_CANDIDATES);

  // Enrich candidates missing a cover but having an ISBN with OL ISBN cover URL.
  // OL covers endpoint works by ISBN even when search result lacks cover_i.
  const topCandidates = deduped.map((c) => {
    if (c.coverUrl) return c;
    const isbn = c.isbn13 ?? c.isbn10;
    if (!isbn) return c;
    return { ...c, coverUrl: `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false` };
  });

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

  // Guard: ai_enabled per profile (S-26)
  const { data: profile } = await locals.supabase
    .from('profiles')
    .select('ai_enabled')
    .eq('id', locals.user.id)
    .single();
  if (!profile?.ai_enabled) {
    return apiError({ code: 'AI_DISABLED', status: 403, message: 'Funkcje AI wyłączone dla tego konta.' });
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

  const { data: existingCandidateRows, error: existingCandidatesError } = await locals.supabase
    .from('book_candidates')
    .select('detection_id, source, external_id, title, authors, isbn_10, isbn_13, publisher, published_year, cover_url, match_score, rank')
    .in('detection_id', detectionRows.map((d) => d.id));

  if (existingCandidatesError) {
    console.error('[api/photos/match POST] existing candidates select failed', {
      name: existingCandidatesError.name,
      message: existingCandidatesError.message,
      code: existingCandidatesError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się pobrać istniejących kandydatów.' });
  }

  const existingByDetection = new Map<string, ExistingCandidateRow[]>();
  for (const row of (existingCandidateRows ?? []) as ExistingCandidateRow[]) {
    const current = existingByDetection.get(row.detection_id) ?? [];
    current.push(row);
    existingByDetection.set(row.detection_id, current);
  }
  for (const [detectionId, rows] of existingByDetection.entries()) {
    existingByDetection.set(detectionId, rows.sort((a, b) => a.rank - b.rank));
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

  // Bounded-concurrency matching: max MATCH_CONCURRENCY simultaneous Google Books calls.
  // Promise.allSettled(35 tasks) caused QPS 429s; this serialises excess into a pool.
  const matchResults = await settledWithConcurrency(
    detectionRows.map((det) => () => matchDetection(det, catalog)),
    MATCH_CONCURRENCY
  );

  let matchedCount = 0;
  let allRateLimited = true;

  type CandidateRow = {
    detection_id: string;
    source: string;
    external_id: string;
    title: string;
    authors: string[];
    isbn_10: string | null;
    isbn_13: string | null;
    publisher: string | null;
    published_year: number | null;
    cover_url: string | null;
    match_score: number;
    rank: number;
  };

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
  let preservedMatchedCount = 0;
  // Collect all candidate rows and matched IDs for 3 batch DB ops instead of 3×N
  const allCandidateRows: CandidateRow[] = [];
  const processedDetectionIds: string[] = []; // processed (non-rate-limited, non-rejected)
  const matchedDetectionIds: string[] = [];   // will be updated to 'matched'

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

    const existingRowsForDetection = existingByDetection.get(det.id) ?? [];
    const existingTopScore =
      existingRowsForDetection.length > 0
        ? existingRowsForDetection.reduce((max, row) => Math.max(max, row.match_score), 0)
        : null;
    const newTopScore = candidates.length > 0 ? candidates[0].matchScore : null;

    const shouldKeepExisting =
      existingRowsForDetection.length > 0 &&
      (newTopScore == null ||
        (existingTopScore != null && existingTopScore - newTopScore >= CONSERVATIVE_REPLACE_MARGIN));

    if (shouldKeepExisting) {
      const responseCandidates = existingRowsForDetection.map((row) => ({
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
      }));

      const topExisting = existingRowsForDetection[0];
      const duplicate = checkCatalogDuplicate(
        {
          source: topExisting.source as ScoredCandidate['source'],
          externalId: topExisting.external_id,
          title: topExisting.title,
          authors: topExisting.authors,
          isbn10: topExisting.isbn_10,
          isbn13: topExisting.isbn_13,
          publisher: topExisting.publisher,
          publishedYear: topExisting.published_year,
          coverUrl: topExisting.cover_url,
          matchScore: topExisting.match_score,
        },
        catalog
      );

      responseDetections.push({
        id: det.id,
        raw_title: det.raw_title ?? '',
        raw_author: det.raw_author,
        position_index: det.position_index,
        status: 'matched',
        candidates: responseCandidates,
        duplicate,
      });

      if (det.status !== 'matched') {
        matchedDetectionIds.push(det.id);
      } else {
        preservedMatchedCount += 1;
      }
      continue;
    }

    processedDetectionIds.push(det.id);

    const hasCandidates = candidates.length > 0;
    if (hasCandidates) {
      matchedDetectionIds.push(det.id);
    }

    for (let idx = 0; idx < candidates.length; idx++) {
      const c = candidates[idx];
      allCandidateRows.push({
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
      });
    }

    responseDetections.push({
      id: det.id,
      raw_title: det.raw_title ?? '',
      raw_author: det.raw_author,
      position_index: det.position_index,
      status: hasCandidates ? 'matched' : det.status,
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

  // BATCH DB operations: 3 subrequests instead of 3×N
  // 1. Delete old candidates for all processed detections
  if (processedDetectionIds.length > 0) {
    await locals.supabase
      .from('book_candidates')
      .delete()
      .in('detection_id', processedDetectionIds);
  }

  // 2. Insert all candidates in one call
  if (allCandidateRows.length > 0) {
    const { error: insertError } = await locals.supabase
      .from('book_candidates')
      .insert(allCandidateRows);

    if (insertError) {
      console.error('[api/photos/match POST] batch book_candidates insert failed', {
        name: insertError.name,
        message: insertError.message,
        code: insertError.code,
        count: allCandidateRows.length,
      });
      return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się zapisać kandydatów.' });
    }
  }

  // 3. Update all matched detection statuses in one call
  if (matchedDetectionIds.length > 0) {
    const { error: statusError } = await locals.supabase
      .from('detections')
      .update({ status: 'matched' })
      .in('id', matchedDetectionIds);

    if (statusError) {
      console.error('[api/photos/match POST] batch detections status update failed', {
        name: statusError.name,
        message: statusError.message,
        code: statusError.code,
      });
    } else {
      matchedCount = matchedDetectionIds.length;
    }
  }

  matchedCount += preservedMatchedCount;

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
