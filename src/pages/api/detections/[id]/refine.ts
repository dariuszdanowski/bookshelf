import type { APIRoute } from 'astro';

import type { BookCandidate, ScoredCandidate } from '../../../../lib/books/schema';
import { getActiveProviderConfig } from '../../../../lib/keys/getActiveProviderConfig';
import { searchGoogleBooks } from '../../../../lib/books/googleBooks';
import { searchOpenLibrary } from '../../../../lib/books/openLibrary';
import { apiError, apiResponse, parseUuidParam } from '../../../../lib/http/response';
import { deriveDetectionCrop } from '../../../../lib/images/crop';
import {
  CONSERVATIVE_REPLACE_MARGIN,
  classifyCropQuality,
  type NormalizedBbox,
} from '../../../../lib/matching/fallbackPolicy';
import {
  checkCatalogDuplicate,
  dedupeCandidates,
  type CatalogDuplicate,
} from '../../../../lib/matching/dedupe';
import { MATCH_MID, scoreCandidate } from '../../../../lib/matching/score';
import { detectSingleSpineFromCrop } from '../../../../lib/vision/client';

export const prerender = false;

const MAX_CANDIDATES = 5;

type ExistingBook = {
  id: string;
  title: string;
  authors: string[];
  isbn_13: string | null;
  isbn_10: string | null;
};

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function matchOne(
  rawTitle: string,
  rawAuthor: string | null,
  existingBooks: ExistingBook[],
): Promise<{ candidates: ScoredCandidate[]; duplicate: CatalogDuplicate; rateLimited: boolean }> {
  const googleResult = await searchGoogleBooks({ title: rawTitle, author: rawAuthor });
  if (!googleResult.ok) {
    return { candidates: [], duplicate: null, rateLimited: googleResult.reason === 'rate_limited' };
  }

  const allCandidates: BookCandidate[] = [...googleResult.candidates];
  const firstIsbn =
    googleResult.candidates.find((c) => c.isbn13)?.isbn13 ??
    googleResult.candidates.find((c) => c.isbn10)?.isbn10 ??
    null;

  if (firstIsbn) {
    const olResult = await searchOpenLibrary({ title: rawTitle, isbn: firstIsbn });
    if (olResult.ok) {
      allCandidates.push(...olResult.candidates);
    }
  }

  const scored: ScoredCandidate[] = allCandidates.map((c) => ({
    ...c,
    matchScore: scoreCandidate(
      { raw_title: rawTitle, raw_author: rawAuthor },
      { title: c.title, authors: c.authors, isbn13: c.isbn13, isbn10: c.isbn10 },
    ),
  }));

  const aboveThreshold = scored.filter((c) => c.matchScore >= MATCH_MID);
  const candidates = dedupeCandidates(aboveThreshold)
    .slice(0, MAX_CANDIDATES)
    .map((c) => {
      if (c.coverUrl) return c;
      const isbn = c.isbn13 ?? c.isbn10;
      if (!isbn) return c;
      return {
        ...c,
        coverUrl: `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`,
      };
    });

  const duplicate =
    candidates.length > 0 ? checkCatalogDuplicate(candidates[0], existingBooks) : null;
  return { candidates, duplicate, rateLimited: false };
}

export const POST: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  // Guard: ai_enabled per profile (parity z process.ts)
  const { data: profile } = await locals.supabase
    .from('profiles')
    .select('ai_enabled')
    .eq('id', locals.user.id)
    .single();
  if (!profile?.ai_enabled) {
    return apiError({ code: 'AI_DISABLED', status: 403, message: 'Analiza AI jest wyłączona.' });
  }

  // Guard: active API key required (S-33)
  const providerConfig = await getActiveProviderConfig(locals.supabase, locals.user.id);
  if (!providerConfig) {
    return apiError({
      code: 'NO_API_KEY',
      status: 403,
      message: 'Brak aktywnego klucza API. Dodaj klucz na stronie /account.',
      details: { account_url: '/account' },
    });
  }

  const detectionId = parseUuidParam(params.id);
  if (!detectionId) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono detekcji.' });
  }

  const { data: detection, error: detectionError } = await locals.supabase
    .from('detections')
    .select(
      'id, photo_id, raw_title, raw_author, vision_confidence, spine_color, status, bbox_x1, bbox_y1, bbox_x2, bbox_y2',
    )
    .eq('id', detectionId)
    .maybeSingle();

  if (detectionError) {
    console.error('[api/detections/refine POST] detection select failed', {
      name: detectionError.name,
      message: detectionError.message,
      code: detectionError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd pobierania detekcji.' });
  }

  if (!detection) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono detekcji.' });
  }

  const bbox: NormalizedBbox | null =
    detection.bbox_x1 != null &&
    detection.bbox_y1 != null &&
    detection.bbox_x2 != null &&
    detection.bbox_y2 != null
      ? {
          x1: detection.bbox_x1,
          y1: detection.bbox_y1,
          x2: detection.bbox_x2,
          y2: detection.bbox_y2,
        }
      : null;

  const cropQuality = classifyCropQuality(bbox);
  if (bbox == null) {
    return apiResponse({
      data: {
        applied: false,
        reason: 'bbox_not_precise',
        crop_quality: cropQuality,
        message: 'Detekcja nie ma wystarczająco precyzyjnego bbox do refine.',
      },
    });
  }

  const { data: photo, error: photoError } = await locals.supabase
    .from('photos')
    .select('id, storage_path')
    .eq('id', detection.photo_id)
    .maybeSingle();

  if (photoError) {
    console.error('[api/detections/refine POST] photo select failed', {
      name: photoError.name,
      message: photoError.message,
      code: photoError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd pobierania zdjęcia.' });
  }

  if (!photo) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono zdjęcia.' });
  }

  const { data: blob, error: downloadError } = await locals.supabase.storage
    .from('shelf-photos')
    .download(photo.storage_path);

  if (downloadError || !blob) {
    console.error('[api/detections/refine POST] storage download failed', {
      message: downloadError?.message ?? 'empty blob',
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się pobrać obrazu ze Storage.',
    });
  }

  let cropBase64: string;
  try {
    const originalBuffer = await blob.arrayBuffer();
    const cropResult = await deriveDetectionCrop(originalBuffer, bbox, {
      paddingPx: 10,
      maxEdge: 1024,
    });
    cropBase64 = toBase64(cropResult.bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[api/detections/refine POST] crop failed', { message });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się przygotować cropa.',
    });
  }

  const refined = await detectSingleSpineFromCrop(
    { base64: cropBase64, mediaType: 'image/jpeg' },
    providerConfig,
  );
  if (!refined.ok) {
    await locals.supabase.from('corrections').insert({
      user_id: locals.user.id,
      detection_id: detection.id,
      original_raw_title: detection.raw_title,
      correction_type: 'parse_failure',
    });

    return apiResponse({
      data: {
        applied: false,
        reason: 'parse_failure',
        message: 'Refine vision output nie przeszedł walidacji.',
      },
    });
  }

  const refinedTitle = refined.detection.title;
  const refinedAuthor = refined.detection.author;

  const { data: existingCandidateRows, error: existingCandidatesError } = await locals.supabase
    .from('book_candidates')
    .select(
      'source, external_id, title, authors, isbn_10, isbn_13, publisher, published_year, cover_url, description, match_score, rank',
    )
    .eq('detection_id', detection.id);

  if (existingCandidatesError) {
    console.error('[api/detections/refine POST] existing candidates select failed', {
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

  const { data: existingBooks, error: booksError } = await locals.supabase
    .from('books')
    .select('id, title, authors, isbn_13, isbn_10')
    .eq('user_id', locals.user.id);

  if (booksError) {
    console.error('[api/detections/refine POST] books select failed', {
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

  const match = await matchOne(refinedTitle, refinedAuthor, catalog);
  if (match.rateLimited) {
    return apiError({
      code: 'RATE_LIMITED',
      status: 429,
      message: 'Google Books rate limit. Spróbuj ponownie za chwilę.',
    });
  }

  const numericExistingScores = (existingCandidateRows ?? [])
    .map((row) => row.match_score)
    .filter((value): value is number => value != null);
  const existingTopScore =
    numericExistingScores.length > 0 ? Math.max(...numericExistingScores) : null;
  const newTopScore = match.candidates.length > 0 ? match.candidates[0].matchScore : null;
  const shouldReplaceCandidates =
    existingTopScore == null ||
    (newTopScore != null && newTopScore + CONSERVATIVE_REPLACE_MARGIN >= existingTopScore);

  const preservedCandidates: ScoredCandidate[] = (existingCandidateRows ?? [])
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .filter((row): row is typeof row & { match_score: number } => row.match_score != null)
    .map((row) => ({
      source: row.source as ScoredCandidate['source'],
      externalId: row.external_id,
      title: row.title,
      authors: row.authors,
      isbn10: row.isbn_10,
      isbn13: row.isbn_13,
      publisher: row.publisher,
      publishedYear: row.published_year,
      coverUrl: row.cover_url,
      description: row.description,
      matchScore: row.match_score,
    }));

  const finalCandidates = shouldReplaceCandidates ? match.candidates : preservedCandidates;
  const finalStatus = finalCandidates.length > 0 ? 'matched' : 'pending';
  const finalDuplicate =
    finalCandidates.length > 0 ? checkCatalogDuplicate(finalCandidates[0], catalog) : null;

  const { error: detectionUpdateError } = await locals.supabase
    .from('detections')
    .update({
      raw_title: refinedTitle,
      raw_author: refinedAuthor,
      vision_confidence: refined.detection.confidence,
      spine_color: refined.detection.spine_color,
      status: finalStatus,
    })
    .eq('id', detection.id);

  if (detectionUpdateError) {
    console.error('[api/detections/refine POST] detection update failed', {
      name: detectionUpdateError.name,
      message: detectionUpdateError.message,
      code: detectionUpdateError.code,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się zaktualizować detekcji.',
    });
  }

  if (shouldReplaceCandidates) {
    const { error: deleteCandidatesError } = await locals.supabase
      .from('book_candidates')
      .delete()
      .eq('detection_id', detection.id);

    if (deleteCandidatesError) {
      console.error('[api/detections/refine POST] candidate delete failed', {
        name: deleteCandidatesError.name,
        message: deleteCandidatesError.message,
        code: deleteCandidatesError.code,
      });
      return apiError({
        code: 'INTERNAL_ERROR',
        status: 500,
        message: 'Nie udało się usunąć starych kandydatów.',
      });
    }
  }

  if (shouldReplaceCandidates && finalCandidates.length > 0) {
    const { error: insertCandidatesError } = await locals.supabase.from('book_candidates').insert(
      finalCandidates.map((c, idx) => ({
        detection_id: detection.id,
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
      })),
    );

    if (insertCandidatesError) {
      console.error('[api/detections/refine POST] candidate insert failed', {
        name: insertCandidatesError.name,
        message: insertCandidatesError.message,
        code: insertCandidatesError.code,
      });
      return apiError({
        code: 'INTERNAL_ERROR',
        status: 500,
        message: 'Nie udało się zapisać kandydatów.',
      });
    }
  }

  // Persist refine call cost — non-blocking (failure doesn't abort response)
  // M27: api_key_id = atrybucja per klucz; defensywny retry bez kolumny
  // (PGRST204) dopóki migracja 0020 nie dotrze na prod (deploy po merge).
  const baseRefineInsert = {
    user_id: locals.user.id,
    photo_id: detection.photo_id,
    detection_id: detection.id,
    model: refined.model,
    cost_usd: refined.costUsd,
    latency_ms: refined.latencyMs,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  void (locals.supabase as any)
    .from('refine_calls')
    .insert({ ...baseRefineInsert, api_key_id: providerConfig.keyId ?? null })
    .then(async ({ error }: { error: { code?: string; message: string } | null }) => {
      if (error?.code === 'PGRST204') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const retry = await (locals.supabase as any).from('refine_calls').insert(baseRefineInsert);
        if (retry.error)
          console.error(
            '[api/detections/refine POST] refine_calls insert failed',
            retry.error.message,
          );
      } else if (error) {
        console.error('[api/detections/refine POST] refine_calls insert failed', error.message);
      }
    });

  return apiResponse({
    data: {
      applied: true,
      detection: {
        id: detection.id,
        status: finalStatus,
        raw_title: refinedTitle,
        raw_author: refinedAuthor,
        vision_confidence: refined.detection.confidence,
        spine_color: refined.detection.spine_color,
        bbox,
      },
      candidates: finalCandidates.map((c, idx) => ({
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
      duplicate: finalDuplicate,
    },
  });
};
