import type { APIRoute } from 'astro';

import { getActiveProviderConfig } from '../../../../lib/keys/getActiveProviderConfig';
import { detectSpines } from '../../../../lib/vision/client';
import { deriveWorkingCopy } from '../../../../lib/images/resize';
import { PROMPT_VERSION } from '../../../../lib/vision/prompt';
import { type PhotoDTO, type DetectionDTO } from '../../../../lib/photos/schema';
import { apiError, parseUuidParam } from '../../../../lib/http/response';
import { findBookCandidates } from '../../../../lib/matching/findCandidates';

export const prerender = false;

const VISION_MODEL = 'claude-sonnet-4-6';

// Chunked base64 encoding (btoa-safe for large binary; no Buffer dependency in CF Workers)
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function sanitizeBbox(
  bbox: [number, number, number, number] | null | undefined,
): [number, number, number, number] | null {
  if (!bbox) return null;

  const [rawX1, rawY1, rawX2, rawY2] = bbox;
  const x1 = Math.min(rawX1, rawX2);
  const y1 = Math.min(rawY1, rawY2);
  const x2 = Math.max(rawX1, rawX2);
  const y2 = Math.max(rawY1, rawY2);

  const width = x2 - x1;
  const height = y2 - y1;
  if (width <= 0 || height <= 0) return null;

  // Reject razor-thin boxes in BOTH dimensions (noise) but keep landscape bboxes
  // (horizontal/lying books have large width, small height — e.g. w=0.19 h=0.05).
  // Old check `height < 0.08` killed all horizontal-book bboxes.
  const minDim = Math.min(width, height);
  if (minDim < 0.012) return null;

  // Guard against false positives on image edges (wall/shelf shadows).
  const touchesLeftOrRightEdge = x1 < 0.02 || x2 > 0.98;
  const looksLikeEdgeStrip = touchesLeftOrRightEdge && width < 0.06 && height > 0.25;
  if (looksLikeEdgeStrip) return null;

  return [x1, y1, x2, y2];
}

/**
 * POST /api/photos/[id]/process
 *
 * Append-only pipeline: każdy call tworzy nowy vision_runs row.
 * Historyczne detekcje są zachowywane — DELETE per photo_id jest zakazane.
 * Trigger DB blokuje concurrent running runs (< 5 min) → 409 CONFLICT.
 *
 * Pre-stream validation (auth/key/photo/vision_run INSERT) zwraca normalne JSON errors.
 * Po vision_run INSERT: odpowiedź przechodzi na SSE streaming, żeby klient mógł
 * utrzymać połączenie podczas długiego wywołania vision (~13s) bez ryzyka
 * zabicia taba przez Android OS po ~6s czekania na blokujący HTTP request.
 *
 * photos.status nie jest używany jako in-flight tracker (to rola vision_runs.status).
 * photos.status = cache ostatniego succeeded run.
 */
export const POST: APIRoute = async ({ params, locals, request }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const id = parseUuidParam(params.id);
  if (!id) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Not found.' });
  }

  const skipMatch = new URL(request.url).searchParams.get('skipMatch') === '1';

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

  // 1. Load photo (RLS scope — PGRST116 if not found or other user)
  const { data: photo, error: photoError } = await locals.supabase
    .from('photos')
    .select('id, storage_path, status')
    .eq('id', id)
    .single();

  if (photoError) {
    if (photoError.code === 'PGRST116') {
      return apiError({ code: 'NOT_FOUND', status: 404, message: 'Not found.' });
    }
    console.error('[api/photos/process POST] photo select failed', {
      name: photoError.name,
      message: photoError.message,
      code: photoError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd pobierania zdjęcia.' });
  }

  // 2. Create vision_run (trigger blokuje concurrent running < 5 min → P0001)
  // M27: api_key_id = atrybucja kosztu per klucz. Defensywnie: dopóki migracja
  // 0020 nie dotrze na prod (deploy po merge), PostgREST nie zna kolumny
  // (PGRST204) → retry bez atrybucji zamiast wywalać pipeline.
  const baseRunInsert = {
    photo_id: id,
    model: VISION_MODEL,
    prompt_version: PROMPT_VERSION,
    status: 'running',
    user_id: locals.user!.id,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let runInsertResult = await (locals.supabase as any)
    .from('vision_runs')
    .insert({ ...baseRunInsert, api_key_id: providerConfig.keyId ?? null })
    .select('id')
    .single();
  if (runInsertResult.error?.code === 'PGRST204') {
    runInsertResult = await locals.supabase
      .from('vision_runs')
      .insert(baseRunInsert)
      .select('id')
      .single();
  }
  const { data: runData, error: runInsertError } = runInsertResult as
    | { data: { id: string }; error: null }
    | { data: null; error: { code?: string; name?: string; message: string } };

  if (runInsertError) {
    if (runInsertError.code === 'P0001') {
      return apiError({
        code: 'CONFLICT',
        status: 409,
        message: runInsertError.message,
      });
    }
    console.error('[api/photos/process POST] vision_run insert failed', {
      name: runInsertError.name,
      message: runInsertError.message,
      code: runInsertError.code,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się utworzyć vision run.',
    });
  }

  const runId = runData.id;

  // --- SSE streaming starts here ---
  // All slow operations (storage download, vision LLM, DB writes) run in an async
  // IIFE that feeds a TransformStream. The Response is returned immediately so the
  // browser keeps the connection alive — critical on mobile (Android kills tabs
  // waiting on long-running HTTP requests after ~6s).
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();

  const sseWrite = (event: string, data: unknown): Promise<void> =>
    writer.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

  const failRun = (msg: string): Promise<unknown> =>
    locals.supabase
      .from('vision_runs')
      .update({
        status: 'failed',
        error_message: msg,
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId);

  void (async () => {
    try {
      await sseWrite('started', {});

      // 3. Download image from Storage → base64
      const { data: blob, error: dlError } = await locals.supabase.storage
        .from('shelf-photos')
        .download(photo.storage_path);

      if (dlError || !blob) {
        const msg = dlError ? dlError.message : 'Empty Storage response';
        await failRun(msg);
        console.error('[api/photos/process POST] storage download failed', { message: msg });
        await sseWrite('error', {
          code: 'INTERNAL_ERROR',
          message: 'Nie udało się pobrać zdjęcia z Storage.',
        });
        return;
      }

      const originalBuffer = await blob.arrayBuffer();

      let workingBytes: Uint8Array;
      let mediaType: 'image/jpeg';
      try {
        const wc = await deriveWorkingCopy(originalBuffer);
        workingBytes = wc.bytes;
        mediaType = wc.mediaType;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[api/photos/process POST] photon deriveWorkingCopy failed', {
          name: err instanceof Error ? err.name : 'UnknownError',
          message: msg,
        });
        await failRun(msg);
        await locals.supabase
          .from('photos')
          .update({ status: 'failed', error_message: msg })
          .eq('id', id);
        await sseWrite('error', {
          code: 'INTERNAL_ERROR',
          message: 'Nie udało się przetworzyć obrazu.',
        });
        return;
      }

      const base64 = toBase64(workingBytes.buffer as ArrayBuffer);

      // 4. Call vision LLM
      let visionResult: Awaited<ReturnType<typeof detectSpines>>;
      try {
        visionResult = await detectSpines({ base64, mediaType }, providerConfig);
      } catch (err) {
        const status = (err as { status?: number })?.status;
        const msg = err instanceof Error ? err.message : String(err);
        await failRun(msg);
        if (status === 429 || status === 529) {
          await sseWrite('error', {
            code: 'RATE_LIMITED',
            message: 'Vision API rate limit. Spróbuj ponownie za chwilę.',
          });
        } else {
          console.error('[api/photos/process POST] vision client error', {
            name: err instanceof Error ? err.name : 'UnknownError',
            message: msg,
            status,
          });
          await sseWrite('error', {
            code: 'INTERNAL_ERROR',
            message: 'Błąd wywołania vision API.',
          });
        }
        return;
      }

      // 5. Handle schema parse failure (retry-with-thinking already exhausted in client)
      if (!visionResult.ok) {
        await locals.supabase.from('corrections').insert({
          user_id: locals.user!.id,
          detection_id: null,
          original_raw_title: null,
          corrected_title: null,
          correction_type: 'parse_failure',
        });
        await locals.supabase
          .from('vision_runs')
          .update({
            status: 'failed',
            error_message: 'Vision output validation failed after retry.',
            latency_ms: visionResult.latencyMs,
            completed_at: new Date().toISOString(),
          })
          .eq('id', runId);
        await locals.supabase
          .from('photos')
          .update({
            status: 'failed',
            error_message: 'Vision output validation failed after retry.',
            vision_latency_ms: visionResult.latencyMs,
          })
          .eq('id', id);
        await sseWrite('error', {
          code: 'VALIDATION_ERROR',
          message: 'Vision output nie przeszedł walidacji schematu.',
        });
        return;
      }

      // 6. Insert detections with vision_run_id (append-only; no DELETE per photo_id)
      let insertedDetections: {
        id: string;
        raw_title: string | null;
        raw_author: string | null;
      }[] = [];
      if (visionResult.detections.length > 0) {
        const { data: detInserted, error: insertError } = await locals.supabase
          .from('detections')
          .insert(
            visionResult.detections.map((d) => {
              const bbox = sanitizeBbox(d.bbox);
              return {
                photo_id: id,
                vision_run_id: runId,
                position_index: d.position,
                raw_title: d.title,
                raw_author: d.author ?? null,
                vision_confidence: d.confidence,
                spine_color: d.spine_color ?? null,
                status: 'pending',
                bbox_x1: bbox?.[0] ?? null,
                bbox_y1: bbox?.[1] ?? null,
                bbox_x2: bbox?.[2] ?? null,
                bbox_y2: bbox?.[3] ?? null,
              };
            }),
          )
          .select('id, raw_title, raw_author');

        if (insertError) {
          await locals.supabase
            .from('vision_runs')
            .update({
              status: 'failed',
              error_message: insertError.message,
              completed_at: new Date().toISOString(),
            })
            .eq('id', runId);
          console.error('[api/photos/process POST] detections insert failed', {
            name: insertError.name,
            message: insertError.message,
            code: insertError.code,
          });
          await sseWrite('error', {
            code: 'INTERNAL_ERROR',
            message: 'Nie udało się zapisać detekcji.',
          });
          return;
        }
        insertedDetections = detInserted ?? [];
      }

      // 6.5 Auto-match: wyszukaj kandydatów równolegle dla wszystkich detekcji.
      // Non-fatal — vision jest już zapisany; błąd matchingu nie psuje pipeline'u.
      // Pominięty gdy ?skipMatch=1 (klient sam uruchamia SSE matching z progress).
      if (!skipMatch && insertedDetections.length > 0) {
        const matchResults = await Promise.allSettled(
          insertedDetections.map(async (det) => {
            const { candidates } = await findBookCandidates(
              det.raw_title ?? '',
              det.raw_author ?? null,
              null,
            );
            return { detectionId: det.id, candidates };
          }),
        );

        const candidateRows = matchResults.flatMap((r) => {
          if (r.status !== 'fulfilled' || r.value.candidates.length === 0) return [];
          return r.value.candidates.map((c, idx) => ({
            detection_id: r.value.detectionId,
            source: c.source,
            external_id: c.externalId,
            title: c.title,
            authors: c.authors,
            isbn_10: c.isbn10 ?? null,
            isbn_13: c.isbn13 ?? null,
            publisher: c.publisher ?? null,
            published_year: c.publishedYear ?? null,
            cover_url: c.coverUrl ?? null,
            description: c.description ?? null,
            match_score: c.matchScore,
            rank: idx + 1,
          }));
        });

        if (candidateRows.length > 0) {
          const { error: candInsertError } = await locals.supabase
            .from('book_candidates')
            .insert(candidateRows);
          if (candInsertError) {
            console.error('[api/photos/process POST] book_candidates insert failed', {
              name: candInsertError.name,
              message: candInsertError.message,
              code: candInsertError.code,
            });
          }
        }

        const matchedIds = matchResults
          .filter((r) => r.status === 'fulfilled' && r.value.candidates.length > 0)
          .map(
            (r) =>
              (r as PromiseFulfilledResult<{ detectionId: string; candidates: unknown[] }>).value
                .detectionId,
          );

        if (matchedIds.length > 0) {
          await locals.supabase
            .from('detections')
            .update({ status: 'matched' })
            .in('id', matchedIds);
        }
      }

      const completedAt = new Date().toISOString();

      // 7. Mark vision_run as succeeded
      await locals.supabase
        .from('vision_runs')
        .update({
          status: 'succeeded',
          cost_usd: visionResult.costUsd,
          latency_ms: visionResult.latencyMs,
          completed_at: completedAt,
        })
        .eq('id', runId);

      // 8. Update photos cache (backward-compat with S-04 DTO consumers)
      const { error: finalError } = await locals.supabase
        .from('photos')
        .update({
          status: 'processed',
          vision_model: visionResult.model,
          vision_cost_usd: visionResult.costUsd,
          vision_latency_ms: visionResult.latencyMs,
          detected_count: visionResult.detections.length,
          processed_at: completedAt,
          error_message: null,
        })
        .eq('id', id);

      if (finalError) {
        console.error('[api/photos/process POST] final status update failed', {
          name: finalError.name,
          message: finalError.message,
          code: finalError.code,
        });
        await sseWrite('error', {
          code: 'INTERNAL_ERROR',
          message: 'Nie udało się zaktualizować statusu zdjęcia.',
        });
        return;
      }

      // 9. Re-fetch final state + detections of THIS run
      const { data: updatedPhoto, error: refetchError } = await locals.supabase
        .from('photos')
        .select(
          'id, shelf_id, status, detected_count, error_message, vision_cost_usd, vision_latency_ms, created_at',
        )
        .eq('id', id)
        .single();

      if (refetchError || !updatedPhoto) {
        console.error('[api/photos/process POST] final re-fetch failed', {
          name: refetchError?.name,
          message: refetchError?.message,
          code: refetchError?.code,
        });
        await sseWrite('error', {
          code: 'INTERNAL_ERROR',
          message: 'Przetworzono, ale nie udało się odczytać stanu zdjęcia.',
        });
        return;
      }

      const { data: detRows } = await locals.supabase
        .from('detections')
        .select(
          'id, position_index, raw_title, raw_author, vision_confidence, spine_color, status, bbox_x1, bbox_y1, bbox_x2, bbox_y2',
        )
        .eq('vision_run_id', runId)
        .order('position_index', { ascending: true });

      const photoDto: PhotoDTO = {
        id: updatedPhoto.id,
        shelf_id: updatedPhoto.shelf_id,
        status: updatedPhoto.status,
        detected_count: updatedPhoto.detected_count,
        error_message: updatedPhoto.error_message,
        vision_cost_usd: updatedPhoto.vision_cost_usd,
        vision_latency_ms: updatedPhoto.vision_latency_ms,
        created_at: updatedPhoto.created_at,
      };

      const detections: DetectionDTO[] = (detRows ?? []).map((row) => ({
        id: row.id,
        position_index: row.position_index,
        raw_title: row.raw_title ?? '',
        raw_author: row.raw_author,
        vision_confidence: row.vision_confidence,
        spine_color: row.spine_color,
        status: row.status,
        bbox:
          row.bbox_x1 != null && row.bbox_y1 != null && row.bbox_x2 != null && row.bbox_y2 != null
            ? { x1: row.bbox_x1, y1: row.bbox_y1, x2: row.bbox_x2, y2: row.bbox_y2 }
            : null,
      }));

      await sseWrite('done', { photo: photoDto, detections });
    } catch (unexpectedErr) {
      const msg = unexpectedErr instanceof Error ? unexpectedErr.message : 'Nieoczekiwany błąd.';
      console.error('[api/photos/process POST] unexpected error in stream', { message: msg });
      try {
        await sseWrite('error', { code: 'INTERNAL_ERROR', message: msg });
      } catch {
        // stream already closed
      }
    } finally {
      writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
};
