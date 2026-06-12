import type { APIRoute } from 'astro';

import { type PhotoListItemDTO, type ShelfPhotosResponse } from '../../../../lib/photos/schema';
import { THUMB_SUFFIX } from '../../../../lib/photos/thumb';
import { apiError, apiResponse, parseUuidParam } from '../../../../lib/http/response';

export const prerender = false;

type PhotoRow = {
  id: string;
  storage_path: string;
  status: string;
  created_at: string;
  file_hash_sha256: string | null;
};

type VisionRunRow = {
  id: string;
  photo_id: string | null;
  model: string | null;
  created_at: string;
  cost_usd: number | null;
};

type DetCountRow = {
  vision_run_id: string;
  total: number;
  matched: number;
  confirmed: number;
};

/**
 * GET /api/shelves/[id]/photos
 *
 * Lista zdjęć półki z metadanymi pipeline'u: stage, liczniki detekcji,
 * signed URL thumbnaila, metadata najnowszego succeeded vision_run.
 *
 * Stage derivation (per plan state machine):
 *   uploaded   — brak succeeded runs (nawet jeśli są failed)
 *   processing — brak succeeded, jest running < 5min
 *   vision_done  — ≥1 succeeded, 0 book_candidates w latest run
 *   match_done   — ≥1 succeeded, ≥1 matched detection, 0 confirmed
 *   confirmed    — ≥1 confirmed detection w latest run
 */
export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const shelfId = parseUuidParam(params.id);
  if (!shelfId) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Not found.' });
  }

  // Verify shelf ownership via RLS
  const { error: shelfError } = await locals.supabase
    .from('shelves')
    .select('id')
    .eq('id', shelfId)
    .single();

  if (shelfError) {
    if (shelfError.code === 'PGRST116') {
      return apiError({ code: 'NOT_FOUND', status: 404, message: 'Not found.' });
    }
    console.error('[api/shelves/photos GET] shelf select failed', {
      name: shelfError.name,
      message: shelfError.message,
      code: shelfError.code,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się pobrać półki.',
    });
  }

  // Photos for this shelf (RLS scoped to user)
  const { data: photos, error: photosError } = await locals.supabase
    .from('photos')
    .select('id, storage_path, status, created_at, file_hash_sha256')
    .eq('shelf_id', shelfId)
    .order('created_at', { ascending: false });

  if (photosError) {
    console.error('[api/shelves/photos GET] photos select failed', {
      name: photosError.name,
      message: photosError.message,
      code: photosError.code,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się pobrać zdjęć.',
    });
  }

  const photoRows: PhotoRow[] = photos ?? [];

  if (photoRows.length === 0) {
    const response: ShelfPhotosResponse = { photos: [] };
    return apiResponse({ data: response });
  }

  const photoIds = photoRows.map((p) => p.id);

  // Batch: latest succeeded vision_run per photo (DISTINCT ON photo_id)
  const { data: succeededRuns, error: runsError } = await locals.supabase
    .from('vision_runs')
    .select('id, photo_id, model, created_at, cost_usd')
    .in('photo_id', photoIds)
    .eq('status', 'succeeded')
    .order('photo_id', { ascending: true })
    .order('created_at', { ascending: false });

  if (runsError) {
    console.error('[api/shelves/photos GET] vision_runs select failed', {
      name: runsError.name,
      message: runsError.message,
      code: runsError.code,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się pobrać vision runs.',
    });
  }

  // Keep only the latest (first after ORDER BY created_at DESC) per photo_id
  const latestRunByPhoto = new Map<string, VisionRunRow>();
  for (const run of succeededRuns ?? []) {
    if (run.photo_id && !latestRunByPhoto.has(run.photo_id)) {
      latestRunByPhoto.set(run.photo_id, run);
    }
  }

  // M26: pełny koszt per zdjęcie (WSZYSTKIE vision_runs + refine_calls — suma
  // spójna z dropdownem CostPanel). Best-effort: błąd → null, UI degraduje.
  const totalCostByPhoto = new Map<string, number>();
  let costsAvailable = false;
  try {
    const [allRunsRes, refineRes] = await Promise.all([
      locals.supabase.from('vision_runs').select('photo_id, cost_usd').in('photo_id', photoIds),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (locals.supabase as any)
        .from('refine_calls')
        .select('photo_id, cost_usd')
        .in('photo_id', photoIds) as Promise<{
        data: Array<{ photo_id: string; cost_usd: number | null }> | null;
        error: { message: string } | null;
      }>,
    ]);
    if (!allRunsRes.error) {
      costsAvailable = true;
      for (const r of allRunsRes.data ?? []) {
        if (!r.photo_id) continue;
        totalCostByPhoto.set(
          r.photo_id,
          (totalCostByPhoto.get(r.photo_id) ?? 0) + (r.cost_usd ?? 0),
        );
      }
      for (const rc of refineRes.data ?? []) {
        totalCostByPhoto.set(
          rc.photo_id,
          (totalCostByPhoto.get(rc.photo_id) ?? 0) + (rc.cost_usd ?? 0),
        );
      }
    }
  } catch (err) {
    console.warn('[api/shelves/photos GET] costs total unavailable', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // Batch: running runs younger than 5 min (for 'processing' stage)
  const { data: runningRuns } = await locals.supabase
    .from('vision_runs')
    .select('photo_id')
    .in('photo_id', photoIds)
    .eq('status', 'running')
    .gt('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString());

  const runningPhotoIds = new Set((runningRuns ?? []).map((r) => r.photo_id));

  // Batch: detection counts per latest succeeded run
  const latestRunIds = [...latestRunByPhoto.values()].map((r) => r.id);

  const detCountsByRun = new Map<string, DetCountRow>();

  if (latestRunIds.length > 0) {
    // Count detections + matched (has book_candidates) + confirmed per vision_run_id
    const { data: detCounts, error: detCountError } = await locals.supabase
      .from('detections')
      .select('vision_run_id, status, book_candidates(id)')
      .in('vision_run_id', latestRunIds);

    if (detCountError) {
      console.error('[api/shelves/photos GET] detections count failed', {
        name: detCountError.name,
        message: detCountError.message,
        code: detCountError.code,
      });
      return apiError({
        code: 'INTERNAL_ERROR',
        status: 500,
        message: 'Nie udało się pobrać liczników detekcji.',
      });
    }

    // Aggregate client-side (≤30 photos × ≤30 detections = manageable)
    for (const det of detCounts ?? []) {
      const runId = det.vision_run_id;
      if (!detCountsByRun.has(runId)) {
        detCountsByRun.set(runId, { vision_run_id: runId, total: 0, matched: 0, confirmed: 0 });
      }
      const agg = detCountsByRun.get(runId)!;
      agg.total++;
      if (Array.isArray(det.book_candidates) && det.book_candidates.length > 0) agg.matched++;
      if (det.status === 'confirmed') agg.confirmed++;
    }
  }

  // Batch signed thumbnail URLs — M15: preferuj miniaturę (<path>.thumb.jpg,
  // generowana przy uploadzie), fallback do oryginału dla legacy zdjęć bez
  // miniatury. Jeden batch call na 2N ścieżek; nieistniejące wpisy wracają
  // z error + signedUrl=null i wypadają z mapy.
  const storagePaths = photoRows.map((p) => p.storage_path);
  const thumbPaths = photoRows.map((p) => `${p.storage_path}${THUMB_SUFFIX}`);
  const { data: signedUrls } = await locals.supabase.storage
    .from('shelf-photos')
    .createSignedUrls([...thumbPaths, ...storagePaths], 3600);

  const urlByPath = new Map<string, string>();
  for (const entry of signedUrls ?? []) {
    if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl);
  }

  // Assemble response
  const resultPhotos: PhotoListItemDTO[] = photoRows.map((p) => {
    const latestRun = latestRunByPhoto.get(p.id) ?? null;
    const hasRunning = runningPhotoIds.has(p.id);
    const counts = latestRun
      ? (detCountsByRun.get(latestRun.id) ?? { total: 0, matched: 0, confirmed: 0 })
      : { total: 0, matched: 0, confirmed: 0 };

    let stage: PhotoListItemDTO['stage'];
    if (!latestRun) {
      stage = hasRunning ? 'processing' : 'uploaded';
    } else if (counts.confirmed > 0) {
      stage = 'confirmed';
    } else if (counts.matched > 0) {
      stage = 'match_done';
    } else {
      stage = 'vision_done';
    }

    return {
      id: p.id,
      status: p.status,
      stage,
      created_at: p.created_at,
      thumbnail_url:
        urlByPath.get(`${p.storage_path}${THUMB_SUFFIX}`) ?? urlByPath.get(p.storage_path) ?? null,
      detected_count: counts.total,
      matched_count: counts.matched,
      confirmed_count: counts.confirmed,
      latest_vision_run: latestRun
        ? {
            id: latestRun.id,
            model: latestRun.model,
            created_at: latestRun.created_at,
            cost_usd: latestRun.cost_usd,
          }
        : null,
      has_running_run: hasRunning,
      legacy_no_hash: p.file_hash_sha256 == null,
      total_cost_usd: costsAvailable ? (totalCostByPhoto.get(p.id) ?? 0) : null,
    };
  });

  const response: ShelfPhotosResponse = { photos: resultPhotos };
  return apiResponse({ data: response });
};
