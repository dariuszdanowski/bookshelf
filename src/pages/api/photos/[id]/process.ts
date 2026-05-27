import type { APIRoute } from 'astro';

import { detectSpines } from '../../../../lib/vision/client';
import { type PhotoDTO, type DetectionDTO } from '../../../../lib/photos/schema';
import { apiError, apiResponse, parseUuidParam } from '../../../../lib/http/response';

export const prerender = false;

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

function detectMediaType(storagePath: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  if (storagePath.endsWith('.png')) return 'image/png';
  if (storagePath.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

/**
 * POST /api/photos/[id]/process
 *
 * Synchroniczny pipeline: Storage download → base64 → Claude Sonnet vision →
 * Zod walidacja → idempotentny zapis detekcji → aktualizacja photos.
 *
 * Idempotencja: delete-then-insert dla `photo_id` — re-process nie duplikuje.
 * Anthropic 429/529: status reset → 'uploaded' (retry możliwy), RATE_LIMITED.
 * parse_failure: INSERT corrections + status 'failed' + 400.
 */
export const POST: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const id = parseUuidParam(params.id);
  if (!id) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Not found.' });
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

  // 2. Transition to processing (idempotent — re-process from any state)
  await locals.supabase.from('photos').update({ status: 'processing' }).eq('id', id);

  // 3. Download image from Storage → base64
  const { data: blob, error: dlError } = await locals.supabase.storage
    .from('shelf-photos')
    .download(photo.storage_path);

  if (dlError || !blob) {
    await locals.supabase.from('photos').update({
      status: 'failed',
      error_message: dlError ? dlError.message : 'Empty Storage response',
    }).eq('id', id);
    console.error('[api/photos/process POST] storage download failed', {
      message: dlError ? dlError.message : 'empty blob',
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się pobrać zdjęcia z Storage.' });
  }

  const base64 = toBase64(await blob.arrayBuffer());
  const mediaType = detectMediaType(photo.storage_path);

  // 4. Call vision LLM (propagate Anthropic errors except 429/529)
  let visionResult: Awaited<ReturnType<typeof detectSpines>>;
  try {
    visionResult = await detectSpines({ base64, mediaType });
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 429 || status === 529) {
      // Rate limited — reset to uploaded so user can retry
      await locals.supabase.from('photos').update({ status: 'uploaded' }).eq('id', id);
      return apiError({ code: 'RATE_LIMITED', status: 429, message: 'Vision API rate limit. Spróbuj ponownie za chwilę.' });
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/photos/process POST] vision client error', {
      name: err instanceof Error ? err.name : 'UnknownError',
      message: msg,
      status,
    });
    await locals.supabase.from('photos').update({ status: 'failed', error_message: msg }).eq('id', id);
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd wywołania vision API.' });
  }

  // 5. Handle schema parse failure (retry-with-thinking already exhausted in client)
  if (!visionResult.ok) {
    await locals.supabase.from('corrections').insert({
      user_id: locals.user.id,
      detection_id: null,
      original_raw_title: null,
      corrected_title: null,
      correction_type: 'parse_failure',
    });
    await locals.supabase.from('photos').update({
      status: 'failed',
      error_message: 'Vision output validation failed after retry.',
      vision_latency_ms: visionResult.latencyMs,
    }).eq('id', id);
    return apiError({ code: 'VALIDATION_ERROR', status: 400, message: 'Vision output nie przeszedł walidacji schematu.' });
  }

  // 6. Idempotent detections write: delete existing → insert fresh
  await locals.supabase.from('detections').delete().eq('photo_id', id);

  if (visionResult.detections.length > 0) {
    const { error: insertError } = await locals.supabase.from('detections').insert(
      visionResult.detections.map((d) => ({
        photo_id: id,
        position_index: d.position,
        raw_title: d.title,
        raw_author: d.author ?? null,
        vision_confidence: d.confidence,
        spine_color: d.spine_color ?? null,
        status: 'pending',
      }))
    );
    // Bez tego check'u: failed insert + flip do 'processed' = cicha utrata
    // danych (detected_count kłamie, GET zwraca pustą listę). Flip do
    // 'failed', by re-process był możliwy i status mówił prawdę.
    if (insertError) {
      await locals.supabase.from('photos').update({
        status: 'failed',
        error_message: insertError.message,
      }).eq('id', id);
      console.error('[api/photos/process POST] detections insert failed', {
        name: insertError.name,
        message: insertError.message,
        code: insertError.code,
      });
      return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się zapisać detekcji.' });
    }
  }

  // 7. Mark photo as processed with metrics
  const { error: finalError } = await locals.supabase.from('photos').update({
    status: 'processed',
    vision_model: visionResult.model,
    vision_cost_usd: visionResult.costUsd,
    vision_latency_ms: visionResult.latencyMs,
    detected_count: visionResult.detections.length,
    processed_at: new Date().toISOString(),
    error_message: null,
  }).eq('id', id);

  if (finalError) {
    console.error('[api/photos/process POST] final status update failed', {
      name: finalError.name,
      message: finalError.message,
      code: finalError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się zaktualizować statusu zdjęcia.' });
  }

  // 8. Re-fetch final state for response (canonical post-update shape).
  // Praca JUŻ się udała (status flipnięty, detekcje zapisane) — gdyby re-fetch
  // padł, nie chcemy raw throw omijającego envelope. Error-check + czysty 500.
  const { data: updatedPhoto, error: refetchError } = await locals.supabase
    .from('photos')
    .select('id, shelf_id, status, detected_count, error_message, vision_cost_usd, vision_latency_ms, created_at')
    .eq('id', id)
    .single();

  if (refetchError || !updatedPhoto) {
    console.error('[api/photos/process POST] final re-fetch failed', {
      name: refetchError?.name,
      message: refetchError?.message,
      code: refetchError?.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Przetworzono, ale nie udało się odczytać stanu zdjęcia.' });
  }

  const { data: detRows } = await locals.supabase
    .from('detections')
    .select('position_index, raw_title, raw_author, vision_confidence, spine_color')
    .eq('photo_id', id)
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
    position_index: row.position_index,
    raw_title: row.raw_title ?? '',
    raw_author: row.raw_author,
    vision_confidence: row.vision_confidence,
    spine_color: row.spine_color,
  }));

  return apiResponse({ data: { photo: photoDto, detections } });
};
