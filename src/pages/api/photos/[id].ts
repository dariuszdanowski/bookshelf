import type { APIRoute } from 'astro';
import { z } from 'zod';

import {
  UpdatePhotoSchema,
  type PhotoDTO,
  type DetectionWithCandidatesDTO,
  type QuadPoints,
} from '../../../lib/photos/schema';
import { THUMB_SUFFIX } from '../../../lib/photos/thumb';
import type { BookCandidateDTO } from '../../../lib/books/schema';
import { checkCatalogDuplicate } from '../../../lib/matching/dedupe';
import { apiError, apiResponse, parseUuidParam } from '../../../lib/http/response';

export const prerender = false;

type ExistingBook = {
  id: string;
  title: string;
  authors: string[];
  isbn_13: string | null;
  isbn_10: string | null;
};

/**
 * GET /api/photos/[id]
 *
 * Zwraca PhotoDTO + (gdy status='processed') listę DetectionWithCandidatesDTO.
 * Detekcje ze statusem 'matched' mają wypełnione candidates + duplicate flag.
 * Page-reload persistence — review page może odświeżyć dane bez utraty propozycji.
 *
 * `parseUuidParam` → 404 przy zniekształconym UUID (privacy-first, FR-NFR).
 * PGRST116 (no rows z `.single()`) → 404 NOT_FOUND.
 */
export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const id = parseUuidParam(params.id);
  if (!id) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Not found.' });
  }

  const { data, error } = await locals.supabase
    .from('photos')
    .select(
      'id, shelf_id, storage_path, status, detected_count, error_message, vision_cost_usd, vision_latency_ms, created_at',
    )
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return apiError({ code: 'NOT_FOUND', status: 404, message: 'Not found.' });
    }
    console.error('[api/photos GET] supabase select failed', {
      name: error.name,
      message: error.message,
      code: error.code,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się pobrać zdjęcia.',
    });
  }

  const photo: PhotoDTO = {
    id: data.id,
    shelf_id: data.shelf_id,
    status: data.status,
    detected_count: data.detected_count,
    error_message: data.error_message,
    vision_cost_usd: data.vision_cost_usd,
    vision_latency_ms: data.vision_latency_ms,
    created_at: data.created_at,
  };

  let photo_url: string | null = null;
  try {
    const { data: signed, error: signedError } = await locals.supabase.storage
      .from('shelf-photos')
      .createSignedUrl(data.storage_path, 3600);
    if (signedError) {
      console.error('[api/photos GET] createSignedUrl failed', {
        name: signedError.name,
        message: signedError.message,
      });
    } else {
      photo_url = signed?.signedUrl ?? null;
    }
  } catch (err) {
    console.error('[api/photos GET] createSignedUrl threw', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // M26: pełny koszt zdjęcia (WSZYSTKIE vision_runs + refine_calls — ta sama
  // suma co dropdown CostPanel/endpoint /costs) + per-detekcja koszt OCR.
  // Best-effort: koszt to dekoracja UI — błąd degraduje do null, nie 500.
  let costsTotalUsd: number | null = null;
  const refineCostByDet = new Map<string, number>();
  try {
    const [allRunsRes, refineRes] = await Promise.all([
      locals.supabase.from('vision_runs').select('cost_usd').eq('photo_id', id),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (locals.supabase as any)
        .from('refine_calls')
        .select('detection_id, cost_usd')
        .eq('photo_id', id) as Promise<{
        data: Array<{ detection_id: string; cost_usd: number | null }> | null;
        error: { message: string } | null;
      }>,
    ]);
    const visionTotal = (allRunsRes.data ?? []).reduce((s, r) => s + (r.cost_usd ?? 0), 0);
    let refineTotal = 0;
    for (const rc of refineRes.data ?? []) {
      refineTotal += rc.cost_usd ?? 0;
      refineCostByDet.set(
        rc.detection_id,
        (refineCostByDet.get(rc.detection_id) ?? 0) + (rc.cost_usd ?? 0),
      );
    }
    if (!allRunsRes.error) costsTotalUsd = visionTotal + refineTotal;
  } catch (err) {
    console.warn('[api/photos GET] costs total unavailable', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // Latest succeeded vision_run — defines which detections to show
  const { data: latestRun, error: runError } = await locals.supabase
    .from('vision_runs')
    .select('id, model, created_at, cost_usd, latency_ms')
    .eq('photo_id', id)
    .eq('status', 'succeeded')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (runError) {
    console.error('[api/photos GET] vision_runs select failed', {
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
    return apiResponse({
      data: {
        photo,
        photo_url,
        detections: [],
        vision_run: null,
        costs_total_usd: costsTotalUsd,
      },
    });
  }

  const visionRun = {
    id: latestRun.id,
    model: latestRun.model,
    created_at: latestRun.created_at,
    cost_usd: latestRun.cost_usd,
    latency_ms: latestRun.latency_ms,
  };

  const { data: detRows, error: detError } = await locals.supabase
    .from('detections')
    .select(
      'id, position_index, raw_title, raw_author, vision_confidence, spine_color, bbox_x1, bbox_y1, bbox_x2, bbox_y2, bbox_quad, status',
    )
    .eq('vision_run_id', latestRun.id)
    .order('position_index', { ascending: true });

  if (detError) {
    console.error('[api/photos GET] detections select failed', {
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

  const rows = detRows ?? [];

  if (rows.length === 0) {
    const detections: DetectionWithCandidatesDTO[] = [];
    return apiResponse({
      data: { photo, photo_url, detections, vision_run: visionRun, costs_total_usd: costsTotalUsd },
    });
  }

  const detectionIds = rows.map((d) => d.id);

  // Parallel: fetch candidates for all detections + user's catalog for duplicate check
  const [candidatesResult, booksResult] = await Promise.all([
    locals.supabase
      .from('book_candidates')
      .select(
        'id, detection_id, source, external_id, title, authors, isbn_10, isbn_13, publisher, published_year, cover_url, match_score, rank',
      )
      .in('detection_id', detectionIds)
      .order('rank', { ascending: true }),
    locals.supabase
      .from('books')
      .select('id, title, authors, isbn_13, isbn_10')
      .eq('user_id', locals.user.id),
  ]);

  if (candidatesResult.error) {
    console.error('[api/photos GET] book_candidates select failed', {
      name: candidatesResult.error.name,
      message: candidatesResult.error.message,
      code: candidatesResult.error.code,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się pobrać kandydatów.',
    });
  }

  if (booksResult.error) {
    console.error('[api/photos GET] books select failed', {
      name: booksResult.error.name,
      message: booksResult.error.message,
      code: booksResult.error.code,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się pobrać katalogu.',
    });
  }

  // Group candidates by detection_id
  const candidatesByDetId = new Map<string, BookCandidateDTO[]>();
  for (const row of candidatesResult.data ?? []) {
    if (!candidatesByDetId.has(row.detection_id)) {
      candidatesByDetId.set(row.detection_id, []);
    }
    candidatesByDetId.get(row.detection_id)!.push({
      id: row.id,
      source: row.source,
      externalId: row.external_id,
      title: row.title,
      authors: row.authors,
      isbn10: row.isbn_10,
      isbn13: row.isbn_13,
      publisher: row.publisher,
      publishedYear: row.published_year,
      coverUrl: row.cover_url,
      matchScore: row.match_score ?? 0,
      rank: row.rank,
    });
  }

  const catalog: ExistingBook[] = (booksResult.data ?? []).map((b) => ({
    id: b.id,
    title: b.title,
    authors: b.authors,
    isbn_13: b.isbn_13,
    isbn_10: b.isbn_10,
  }));

  const detections: DetectionWithCandidatesDTO[] = rows.map((row) => {
    const candidates = candidatesByDetId.get(row.id) ?? [];

    let duplicate: DetectionWithCandidatesDTO['duplicate'] = null;
    if (candidates.length > 0) {
      const top = candidates[0];
      duplicate = checkCatalogDuplicate(
        {
          source: top.source as 'google_books' | 'open_library',
          externalId: top.externalId,
          title: top.title,
          authors: top.authors,
          isbn10: top.isbn10,
          isbn13: top.isbn13,
          publisher: top.publisher,
          publishedYear: top.publishedYear,
          coverUrl: top.coverUrl,
          // DTO nie niesie opisu (UI go nie pokazuje); checkCatalogDuplicate go nie używa.
          description: null,
          matchScore: top.matchScore,
        },
        catalog,
      );
    }

    return {
      id: row.id,
      position_index: row.position_index,
      raw_title: row.raw_title ?? '',
      raw_author: row.raw_author,
      vision_confidence: row.vision_confidence,
      spine_color: row.spine_color,
      bbox:
        row.bbox_x1 != null && row.bbox_y1 != null && row.bbox_x2 != null && row.bbox_y2 != null
          ? { x1: row.bbox_x1, y1: row.bbox_y1, x2: row.bbox_x2, y2: row.bbox_y2 }
          : null,
      quad: (row.bbox_quad as QuadPoints | null) ?? null,
      status: row.status,
      candidates,
      duplicate,
      // M26: koszt OCR (refine) tej detekcji — etykieta przycisku $ na karcie
      refine_cost_usd: refineCostByDet.get(row.id) ?? 0,
    };
  });

  return apiResponse({
    data: { photo, photo_url, detections, vision_run: visionRun, costs_total_usd: costsTotalUsd },
  });
};

/**
 * PATCH /api/photos/[id]
 *
 * Przenosi zdjęcie na inną półkę (`shelf_id`). RLS scope'uje do `auth.uid()`;
 * próba przeniesienia na cudzą/nieistniejącą półkę → FK violation 23503 → 404.
 * Próba update'u cudzego zdjęcia → 0 rows → PGRST116 → 404.
 *
 * Body: `{ shelf_id }`. „retitle" świadomie poza zakresem — `photos` nie ma kolumny title.
 */
export const PATCH: APIRoute = async ({ request, params, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const id = parseUuidParam(params.id);
  if (!id) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Not found.' });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError({ code: 'VALIDATION_ERROR', status: 400, message: 'Invalid JSON body.' });
  }

  const parsed = UpdatePhotoSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Invalid photo input.',
      details: z.flattenError(parsed.error),
    });
  }

  const { data, error } = await locals.supabase
    .from('photos')
    .update({ shelf_id: parsed.data.shelf_id })
    .eq('id', id)
    .select(
      'id, shelf_id, status, detected_count, error_message, vision_cost_usd, vision_latency_ms, created_at',
    )
    .single();

  if (error) {
    // 23503 = FK violation — docelowa półka nie istnieje lub należy do innego usera (RLS).
    if (error.code === '23503') {
      return apiError({
        code: 'NOT_FOUND',
        status: 404,
        message: 'Półka nie istnieje lub brak dostępu.',
      });
    }
    // PGRST116 = 0 rows (zdjęcie nie istnieje lub RLS scope).
    if (error.code === 'PGRST116') {
      return apiError({ code: 'NOT_FOUND', status: 404, message: 'Not found.' });
    }
    console.error('[api/photos PATCH] supabase update failed', {
      name: error.name,
      message: error.message,
      code: error.code,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się zaktualizować zdjęcia.',
    });
  }

  const photo: PhotoDTO = {
    id: data.id,
    shelf_id: data.shelf_id,
    status: data.status,
    detected_count: data.detected_count,
    error_message: data.error_message,
    vision_cost_usd: data.vision_cost_usd,
    vision_latency_ms: data.vision_latency_ms,
    created_at: data.created_at,
  };

  return apiResponse({ data: { photo } });
};

/**
 * DELETE /api/photos/[id]
 *
 * Usuwa zdjęcie: najpierw kasuje wiersz DB (kaskada: detections → book_candidates;
 * shelf_entries.photo_id/detection_id → SET NULL, więc skatalogowane książki zostają;
 * vision_runs/refine_calls.photo_id → SET NULL po S-30, więc historia kosztów przeżywa),
 * potem best-effort czyści plik ze Storage (błąd Storage tylko logujemy — wiersz DB już
 * zniknął, więc dla usera operacja się udała; ewentualna sierota pliku do batch-cleanu).
 *
 * Kolejność DB-first: błąd Storage zostawia niewidzialną sierotę pliku zamiast wiersza DB
 * z zepsutą miniaturą.
 */
export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const id = parseUuidParam(params.id);
  if (!id) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Not found.' });
  }

  // Pre-check existence + RLS scope; zachowujemy storage_path do czyszczenia po delete.
  const { data: existing, error: selectError } = await locals.supabase
    .from('photos')
    .select('id, storage_path')
    .eq('id', id)
    .maybeSingle();

  if (selectError) {
    console.error('[api/photos DELETE] pre-check select failed', {
      name: selectError.name,
      message: selectError.message,
      code: selectError.code,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się sprawdzić zdjęcia.',
    });
  }

  if (!existing) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Not found.' });
  }

  const { error: deleteError } = await locals.supabase.from('photos').delete().eq('id', id);

  if (deleteError) {
    console.error('[api/photos DELETE] supabase delete failed', {
      name: deleteError.name,
      message: deleteError.message,
      code: deleteError.code,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się usunąć zdjęcia.',
    });
  }

  // Best-effort Storage cleanup — błąd nie zmienia sukcesu (wiersz DB już usunięty).
  // M15: usuwamy też miniaturę (<path>.thumb.jpg); brak pliku nie jest błędem remove.
  try {
    const { error: rmError } = await locals.supabase.storage
      .from('shelf-photos')
      .remove([existing.storage_path, `${existing.storage_path}${THUMB_SUFFIX}`]);
    if (rmError) {
      console.error('[api/photos DELETE] storage remove failed (orphan left)', {
        name: rmError.name,
        message: rmError.message,
      });
    }
  } catch (err) {
    console.error('[api/photos DELETE] storage remove threw (orphan left)', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return apiResponse({ data: { deleted: true } });
};
