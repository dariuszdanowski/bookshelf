import type { APIRoute } from 'astro';

import { decryptWithEnvKey } from '../../../../../lib/keys/crypto';
import { probeKey } from '../../../../../lib/keys/probe';
import { apiError, apiResponse, parseUuidParam } from '../../../../../lib/http/response';

export const prerender = false;

/**
 * POST /api/account/keys/[id]/test
 *
 * Server-side probe: decrypt → GET /v1/models → zapisz wynik → zwróć.
 * Zawsze 200 — błąd probe to wynik testu, nie błąd serwera.
 * Plaintext klucza przechodzi wyłącznie server-side, nigdy w odpowiedzi.
 */
export const POST: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const id = parseUuidParam(params.id);
  if (!id) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Klucz nie istnieje.' });
  }

  const { data: row, error: fetchError } = await locals.supabase
    .from('user_api_keys')
    .select('id,provider,model,base_url,encrypted_key,user_id')
    .eq('id', id)
    .eq('user_id', locals.user.id)
    .single();

  if (fetchError) {
    if (fetchError.code === 'PGRST116') {
      return apiError({ code: 'NOT_FOUND', status: 404, message: 'Klucz nie istnieje.' });
    }
    console.error('[api/account/keys/[id]/test POST] fetch failed', {
      name: fetchError.name,
      message: fetchError.message,
      code: fetchError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się pobrać klucza.' });
  }

  let result: 'ok' | 'error';
  try {
    const plaintext = await decryptWithEnvKey(row.encrypted_key);
    result = await probeKey(row.provider as Parameters<typeof probeKey>[0], plaintext, row.base_url);
  } catch {
    result = 'error';
  }

  // Zapisz wynik — błąd zapisu nie przesłania wyniku testu
  await locals.supabase
    .from('user_api_keys')
    .update({ last_tested_at: new Date().toISOString(), last_test_result: result })
    .eq('id', id);

  return apiResponse({ data: { result } });
};
