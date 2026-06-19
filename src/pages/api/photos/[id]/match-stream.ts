import type { APIRoute } from 'astro';

import { apiError, parseUuidParam } from '../../../../lib/http/response';
import { CONSERVATIVE_REPLACE_MARGIN } from '../../../../lib/matching/fallbackPolicy';
import {
  type ExistingBook,
  runMatchingWithProgress,
  MATCH_CONCURRENCY,
} from '../../../../lib/matching/runner';

export const prerender = false;

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
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
  description: string | null;
  match_score: number;
  rank: number;
};

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
  description: string | null;
  match_score: number;
  rank: number;
};

/**
 * GET /api/photos/[id]/match-stream
 *
 * SSE endpoint: streams matching progress for non-rejected detections.
 * Emits `event: progress` per detection completion, `event: done` on finish.
 * Auth and business logic mirrors POST /match; no DB schema changes.
 */
export const GET: APIRoute = async ({ params, locals }) => {
  const id = parseUuidParam(params.id);
  if (!id) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Not found.' });
  }

  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  // Guard: ai_enabled per profile (S-26)
  const { data: profile } = await locals.supabase
    .from('profiles')
    .select('ai_enabled')
    .eq('id', locals.user.id)
    .single();
  if (!profile?.ai_enabled) {
    return apiError({
      code: 'AI_DISABLED',
      status: 403,
      message: 'Funkcje AI wyłączone dla tego konta.',
    });
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
    console.error('[api/photos/match-stream GET] photo select failed', {
      name: photoError.name,
      message: photoError.message,
      code: photoError.code,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się pobrać zdjęcia.',
    });
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
    console.error('[api/photos/match-stream GET] vision_runs select failed', {
      name: runError.name,
      message: runError.message,
      code: runError.code,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się pobrać vision run.',
    });
  }

  if (!latestRun) {
    return apiError({
      code: 'NOT_FOUND',
      status: 404,
      message: 'Brak zakończonego vision run dla tego zdjęcia.',
    });
  }

  // Non-rejected detections from the latest succeeded run only
  const { data: detectionRows, error: detError } = await locals.supabase
    .from('detections')
    .select('id, raw_title, raw_author, status, position_index')
    .eq('vision_run_id', latestRun.id)
    .neq('status', 'rejected');

  if (detError) {
    console.error('[api/photos/match-stream GET] detections select failed', {
      name: detError.name,
      message: detError.message,
      code: detError.code,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się pobrać detekcji.',
    });
  }

  const enc = new TextEncoder();

  // No detections → emit done immediately without opening stream work
  if (!detectionRows || detectionRows.length === 0) {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(enc.encode('event: done\ndata: {"matched":0,"rate_limited":0}\n\n'));
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: SSE_HEADERS });
  }

  // Load existing candidates for conservative replace check
  const { data: existingCandidateRows, error: existingCandidatesError } = await locals.supabase
    .from('book_candidates')
    .select(
      'detection_id, source, external_id, title, authors, isbn_10, isbn_13, publisher, published_year, cover_url, description, match_score, rank',
    )
    .in(
      'detection_id',
      detectionRows.map((d) => d.id),
    );

  if (existingCandidatesError) {
    console.error('[api/photos/match-stream GET] existing candidates select failed', {
      name: existingCandidatesError.name,
      message: existingCandidatesError.message,
      code: existingCandidatesError.code,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się pobrać istniejących kandydatów.',
    });
  }

  const existingByDetection = new Map<string, ExistingCandidateRow[]>();
  for (const row of (existingCandidateRows ?? []) as ExistingCandidateRow[]) {
    const current = existingByDetection.get(row.detection_id) ?? [];
    current.push(row);
    existingByDetection.set(row.detection_id, current);
  }
  for (const [detectionId, rows] of existingByDetection.entries()) {
    existingByDetection.set(
      detectionId,
      rows.sort((a, b) => a.rank - b.rank),
    );
  }

  // Preload catalog for duplicate check inside matchDetection
  const { data: existingBooks, error: booksError } = await locals.supabase
    .from('books')
    .select('id, title, authors, isbn_13, isbn_10')
    .eq('user_id', locals.user.id);

  if (booksError) {
    console.error('[api/photos/match-stream GET] books select failed', {
      name: booksError.name,
      message: booksError.message,
      code: booksError.code,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się pobrać katalogu.',
    });
  }

  const catalog: ExistingBook[] = (existingBooks ?? []).map((b) => ({
    id: b.id,
    title: b.title,
    authors: b.authors,
    isbn_13: b.isbn_13,
    isbn_10: b.isbn_10,
  }));

  // Capture supabase client for use inside the stream (Astro locals are per-request)
  const supabase = locals.supabase;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const matchResults = await runMatchingWithProgress(
          detectionRows,
          catalog,
          MATCH_CONCURRENCY,
          (evt) => {
            controller.enqueue(
              enc.encode(
                `event: progress\ndata: ${JSON.stringify({
                  index: evt.index,
                  total: evt.total,
                  title: evt.title,
                  detectionId: evt.detectionId,
                })}\n\n`,
              ),
            );
          },
        );

        // Post-processing: conservative replace + batch DB writes (mirrors match.ts)
        let matchedCount = 0;
        let allRateLimited = true;
        let rateLimitedCount = 0;
        let preservedMatchedCount = 0;

        const allCandidateRows: CandidateRow[] = [];
        const processedDetectionIds: string[] = [];
        const matchedDetectionIds: string[] = [];

        for (let i = 0; i < detectionRows.length; i++) {
          const det = detectionRows[i];
          const result = matchResults[i];

          if (result.status === 'rejected') {
            allRateLimited = false;
            continue;
          }

          const { candidates, rateLimited } = result.value;
          if (!rateLimited) allRateLimited = false;

          if (rateLimited) {
            rateLimitedCount++;
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
              (existingTopScore != null &&
                existingTopScore - newTopScore >= CONSERVATIVE_REPLACE_MARGIN));

          if (shouldKeepExisting) {
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
              description: c.description,
              match_score: c.matchScore,
              rank: idx + 1,
            });
          }
        }

        // 1. Delete old candidates for all processed detections
        if (processedDetectionIds.length > 0) {
          await supabase.from('book_candidates').delete().in('detection_id', processedDetectionIds);
        }

        // 2. Insert all new candidates in one call
        if (allCandidateRows.length > 0) {
          const { error: insertError } = await supabase
            .from('book_candidates')
            .insert(allCandidateRows);

          if (insertError) {
            console.error('[api/photos/match-stream GET] batch book_candidates insert failed', {
              name: insertError.name,
              message: insertError.message,
              code: insertError.code,
              count: allCandidateRows.length,
            });
            controller.enqueue(
              enc.encode(
                `event: error\ndata: ${JSON.stringify({ message: 'Nie udało się zapisać kandydatów.', code: 'INTERNAL_ERROR' })}\n\n`,
              ),
            );
            controller.close();
            return;
          }
        }

        // 3. Update matched detection statuses in one call
        if (matchedDetectionIds.length > 0) {
          const { error: statusError } = await supabase
            .from('detections')
            .update({ status: 'matched' })
            .in('id', matchedDetectionIds);

          if (statusError) {
            console.error('[api/photos/match-stream GET] batch detections status update failed', {
              name: statusError.name,
              message: statusError.message,
              code: statusError.code,
            });
          } else {
            matchedCount = matchedDetectionIds.length;
          }
        }

        matchedCount += preservedMatchedCount;

        // All rate-limited → emit error event (client can retry via sync POST)
        if (detectionRows.length > 0 && allRateLimited && matchedCount === 0) {
          controller.enqueue(
            enc.encode(
              `event: error\ndata: ${JSON.stringify({ message: 'Google Books rate limit. Spróbuj ponownie za chwilę.', code: 'RATE_LIMITED' })}\n\n`,
            ),
          );
          controller.close();
          return;
        }

        controller.enqueue(
          enc.encode(
            `event: done\ndata: ${JSON.stringify({ matched: matchedCount, rate_limited: rateLimitedCount })}\n\n`,
          ),
        );
        controller.close();
      } catch (e) {
        console.error('[api/photos/match-stream GET] stream error', e);
        try {
          controller.enqueue(
            enc.encode(
              `event: error\ndata: ${JSON.stringify({ message: 'Błąd wewnętrzny serwera.', code: 'INTERNAL_ERROR' })}\n\n`,
            ),
          );
          controller.close();
        } catch {
          // Controller already closed — ignore
        }
      }
    },
  });

  return new Response(stream, { status: 200, headers: SSE_HEADERS });
};
