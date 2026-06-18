import type { APIRoute } from 'astro';

import { apiError, apiResponse } from '../../../lib/http/response';
import { THUMB_SUFFIX } from '../../../lib/photos/thumb';

export const prerender = false;

const MAX_THUMB_SIZE_BYTES = 512 * 1024; // 512 KB — miniatura 640px JPEG nie przekroczy

/**
 * POST /api/photos/upload-thumbnail
 *
 * Proxy upload miniatury: przeglądarka generuje blob (canvas) i wysyła go tutaj
 * jako multipart/form-data. Serwer wgrywa do Supabase Storage po stronie serwera
 * (widzi poprawny URL, niezależnie od urządzenia).
 *
 * Rozwiązuje problem z bezpośrednim dostępem przeglądarki do Supabase Storage —
 * PUBLIC_SUPABASE_URL na devsie wskazuje na WSL2 IP (127.0.0.1:54321),
 * nieosiągalny z urządzeń mobilnych w LAN.
 *
 * Body (FormData):
 *   thumb: Blob / File — JPEG miniatura (wymagany)
 *   storagePath: string — ścieżka oryginału w storage (wymagana)
 *
 * Odpowiedzi:
 *   204 — miniatura wgrana (lub pominięta — best-effort)
 *   400 / 401 — walidacja / brak auth
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

  const thumb = formData.get('thumb');
  const storagePath = formData.get('storagePath');

  if (!(thumb instanceof Blob) || thumb.size === 0) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Brak miniatury w żądaniu.',
    });
  }

  if (typeof storagePath !== 'string' || !storagePath) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Brak storagePath w żądaniu.',
    });
  }

  if (thumb.size > MAX_THUMB_SIZE_BYTES) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Miniatura za duża (max 512 KB).',
    });
  }

  // Zabezpieczenie: ścieżka musi należeć do zalogowanego usera
  if (!storagePath.startsWith(`${locals.user.id}/`)) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Not found.' });
  }

  const thumbPath = `${storagePath}${THUMB_SUFFIX}`;
  const buffer = await thumb.arrayBuffer();

  const { error } = await locals.supabase.storage
    .from('shelf-photos')
    .upload(thumbPath, buffer, { contentType: 'image/jpeg', upsert: false });

  if (error) {
    console.warn('[api/photos/upload-thumbnail POST] storage upload failed', error.message);
    // best-effort — nie blokujemy głównego flow
  }

  return apiResponse({ data: null, status: 200 });
};
