import type { APIRoute } from 'astro';
import { z } from 'zod';

import { RecordPhotoSchema, type PhotoDTO } from '../../../lib/photos/schema';
import { apiError, apiResponse } from '../../../lib/http/response';

export const prerender = false;

/**
 * POST /api/photos
 *
 * Rejestruje wiersz `photos` po tym jak browser wgrał plik bezpośrednio
 * do Supabase Storage. Waliduje storage_path (musi zaczynać się od
 * `{user.id}/` — defense-in-depth, fail fast zamiast 500 przy /process).
 *
 * SQLSTATE mapping:
 * - 23503 (FK violation: shelf_id nie istnieje lub poza RLS scope) → 404 NOT_FOUND
 * - inne → 500 INTERNAL_ERROR
 */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError({ code: 'VALIDATION_ERROR', status: 400, message: 'Invalid JSON body.' });
  }

  const parsed = RecordPhotoSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Invalid photo input.',
      details: z.flattenError(parsed.error),
    });
  }

  const { shelf_id, storage_path, file_hash_sha256 } = parsed.data;

  // F4 defense-in-depth: storage_path musi należeć do tego usera
  if (!storage_path.startsWith(`${locals.user.id}/`)) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'storage_path musi zaczynać się od identyfikatora użytkownika.',
    });
  }

  const { data, error } = await locals.supabase
    .from('photos')
    .insert({ user_id: locals.user.id, shelf_id, storage_path, status: 'uploaded', file_hash_sha256: file_hash_sha256 ?? null })
    .select('id, shelf_id, status, detected_count, error_message, vision_cost_usd, vision_latency_ms, created_at')
    .single();

  if (error) {
    if (error.code === '23503') {
      return apiError({ code: 'NOT_FOUND', status: 404, message: 'Półka nie istnieje lub brak dostępu.' });
    }
    if (error.code === '23505') {
      // Cleanup sieroty: przy 23505 (kolizja hash) świeżo wgrany obiekt Storage nie
      // dostał rekordu w `photos` — to jedyny unique index na photos, więc 23505 ⇒
      // duplikat hash (zob. plan F3). Race przy współbieżnym uploadzie nowego obrazu.
      // Best-effort — błąd cleanup logujemy, ale NIE zmieniamy odpowiedzi 409 (F1).
      try {
        const { error: rmError } = await locals.supabase.storage.from('shelf-photos').remove([storage_path]);
        if (rmError) {
          // storage.remove zwraca błędy przez {error}, nie throw (throw tylko na network)
          console.error('[api/photos POST] orphan storage cleanup returned error', {
            storage_path,
            message: rmError.message,
          });
        }
      } catch (cleanupErr) {
        console.error('[api/photos POST] orphan storage cleanup threw', {
          storage_path,
          message: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
        });
      }
      return apiError({ code: 'DUPLICATE_PHOTO', status: 409, message: 'Zdjęcie już istnieje w katalogu.' });
    }
    console.error('[api/photos POST] supabase insert failed', {
      name: error.name,
      message: error.message,
      code: error.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się zarejestrować zdjęcia.' });
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

  return apiResponse({ data: { photo }, status: 201 });
};
