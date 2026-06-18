import type { APIRoute } from 'astro';

import { apiError, parseUuidParam } from '../../../../lib/http/response';
import { THUMB_SUFFIX } from '../../../../lib/photos/thumb';

export const prerender = false;

/**
 * GET /api/photos/[id]/image[?thumb=1]
 *
 * Proxy dla pliku zdjęcia: pobiera z Supabase Storage po stronie serwera
 * i serwuje bajtami do klienta. Rozwiązuje problem z dostępem do zdjęć na
 * urządzeniach mobilnych w sieci LAN — signed URL wskazuje na lokalny IP
 * (127.0.0.1:54321 lub WSL2), niedostępny z telefonu; ten endpoint jest
 * zawsze dostępny pod tym samym hostem co aplikacja.
 *
 * `?thumb=1` serwuje miniaturę `<path>.thumb.jpg` (generowaną przy uploadzie),
 * z fallbackiem do oryginału gdy miniatury brak (legacy / HEIC nie-dekodowalny
 * przez photon). Miniatury też muszą iść przez proxy — inaczej signed URL na
 * WSL IP nie ładuje się na telefonie (pełne zdjęcie już proxy'owane).
 *
 * Cache-Control: private, max-age=3600 — agresywny cache po stronie klienta
 * (1h), bo URL zawiera UUID zdjęcia, który się nie zmienia.
 */
export const GET: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const id = parseUuidParam(params.id);
  if (!id) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Not found.' });
  }

  const { data, error } = await locals.supabase
    .from('photos')
    .select('storage_path')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return apiError({ code: 'NOT_FOUND', status: 404, message: 'Not found.' });
    }
    console.error('[api/photos/image GET] supabase select failed', {
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

  // Wariant miniatury: spróbuj `<path>.thumb.jpg`; brak (legacy / HEIC) → spadamy
  // do serwowania oryginału poniżej.
  if (new URL(request.url).searchParams.has('thumb')) {
    const { data: thumbBlob } = await locals.supabase.storage
      .from('shelf-photos')
      .download(`${data.storage_path}${THUMB_SUFFIX}`);
    if (thumbBlob) {
      return new Response(await thumbBlob.arrayBuffer(), {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' },
      });
    }
  }

  const { data: blob, error: dlError } = await locals.supabase.storage
    .from('shelf-photos')
    .download(data.storage_path);

  if (dlError || !blob) {
    console.error('[api/photos/image GET] storage download failed', {
      name: dlError?.name,
      message: dlError?.message,
    });
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Plik nie znaleziony w storage.' });
  }

  const ext = data.storage_path.split('.').pop()?.toLowerCase() ?? 'jpg';
  const contentTypeMap: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    heic: 'image/heic',
    heif: 'image/heif',
  };
  const contentType = contentTypeMap[ext] ?? 'image/jpeg';

  return new Response(await blob.arrayBuffer(), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=3600',
    },
  });
};
