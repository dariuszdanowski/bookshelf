import type { APIRoute } from 'astro';

import { apiError, apiResponse } from '../../../lib/http/response';
import { deriveThumbnail } from '../../../lib/images/resize';
import { THUMB_SUFFIX } from '../../../lib/photos/thumb';

export const prerender = false;

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * POST /api/photos/upload-file
 *
 * Proxy upload: przeglądarka wysyła plik jako multipart/form-data na serwer
 * (dostępny w LAN pod IP hosta), serwer uploaduje do Supabase Storage
 * korzystając z server-side client (widzi WSL2/prod URL niezależnie od urządzenia).
 * Serwer zawsze oblicza SHA-256 i sprawdza duplikaty — rozwiązuje problem
 * z brakiem crypto.subtle w non-secure context (HTTP LAN).
 *
 * Body (FormData):
 *   file: File — plik zdjęcia (wymagany)
 *
 * Odpowiedzi:
 *   201 { data: { storagePath, sha256 } }
 *   409 { error: { code: 'DUPLICATE_PHOTO', details: { photo: { id, shelf_id, created_at } } } }
 */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Oczekiwano multipart/form-data.',
    });
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return apiError({ code: 'VALIDATION_ERROR', status: 400, message: 'Brak pliku w żądaniu.' });
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Plik jest za duży (max 15 MB).',
    });
  }

  const buffer = await file.arrayBuffer();

  // SHA-256 server-side — crypto.subtle dostępne zawsze (Workers/Node).
  // Rozwiązuje brak crypto.subtle w non-secure context (http LAN).
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const sha256 = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Dedup check — autorytatywny (serwer widzi DB niezależnie od kontekstu klienta).
  const { data: existing } = await locals.supabase
    .from('photos')
    .select('id, shelf_id, created_at')
    .eq('user_id', locals.user.id)
    .eq('file_hash_sha256', sha256)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return apiError({
      code: 'DUPLICATE_PHOTO',
      status: 409,
      message: 'Zdjęcie o tym samym hashu już istnieje w Twoim katalogu.',
      details: { photo: existing },
    });
  }

  const ext = (file.name.split('.').pop()?.toLowerCase() ?? 'jpg').replace(/[^a-z0-9]/g, '');
  const randomPart = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const storagePath = `${locals.user.id}/${randomPart}.${ext || 'jpg'}`;

  const { error: upErr } = await locals.supabase.storage
    .from('shelf-photos')
    .upload(storagePath, buffer, {
      contentType: file.type || 'image/jpeg',
      upsert: false,
    });

  if (upErr) {
    console.error('[api/photos/upload-file POST] storage upload failed', {
      message: upErr.message,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: `Nie udało się wgrać pliku: ${upErr.message}`,
    });
  }

  // M15: miniatura generowana server-side z już posiadanego buffer (photon),
  // zapisywana obok oryginału jako `<storagePath>.thumb.jpg`. Best-effort —
  // błąd generowania/uploadu (np. HEIC nie-dekodowalny przez photon) NIE blokuje
  // sukcesu uploadu oryginału; lista fallbackuje do oryginału.
  //
  // Guard: pomijamy miniaturę dla dużych plików. Photon WASM dekoduje JPEG do
  // surowych pikseli przed skalowaniem — duże zdjęcia z komórki (≥8 MB skompresowane
  // = potencjalnie 100-200 MB surowych pikseli) przekraczają limit pamięci Worker
  // (128 MB) i crashują izolat zamiast rzucić wyjątek, którego try/catch by złapał.
  const THUMB_MAX_INPUT_BYTES = 8 * 1024 * 1024; // 8 MB kompresji ≈ bezpieczny próg
  if (file.size > THUMB_MAX_INPUT_BYTES) {
    console.warn(
      `[api/photos/upload-file POST] skipping thumbnail for large file (${(file.size / 1024 / 1024).toFixed(1)} MB)`,
    );
  } else {
    try {
      const thumbBytes = await deriveThumbnail(buffer);
      const { error: thumbErr } = await locals.supabase.storage
        .from('shelf-photos')
        .upload(`${storagePath}${THUMB_SUFFIX}`, thumbBytes, {
          contentType: 'image/jpeg',
          upsert: false,
        });
      if (thumbErr) {
        console.warn('[api/photos/upload-file POST] thumbnail upload failed', thumbErr.message);
      }
    } catch (err) {
      console.warn(
        '[api/photos/upload-file POST] thumbnail generation failed',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return apiResponse({ data: { storagePath, sha256 }, status: 201 });
};
