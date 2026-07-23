import type { APIRoute } from 'astro';
import { z } from 'zod';

import { decryptWithEnvKey } from '../../../../lib/keys/crypto';
import { listModels } from '../../../../lib/keys/probe';
import { ListModelsInputSchema, normalizeBaseUrl } from '../../../../lib/keys/schema';
import { apiError, apiResponse } from '../../../../lib/http/response';

export const prerender = false;

/**
 * POST /api/account/keys/models
 *
 * Probe-style endpoint (mirror `[id]/test.ts`): zawsze 200, wynik probe'u w
 * payloadzie, nie w kodzie HTTP. Klucz do odpytania providera pochodzi albo
 * bezpośrednio z body (`key_value` — add-form / edit-form z nowym kluczem),
 * albo z odszyfrowania już zapisanego wiersza (`id` — edit-form z pustym
 * polem "nowy klucz"). Plaintext klucza nigdy nie wraca w odpowiedzi.
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

  const parsed = ListModelsInputSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Invalid input.',
      details: z.flattenError(parsed.error),
    });
  }

  const baseUrl = normalizeBaseUrl(parsed.data.base_url);

  let apiKey: string;
  if (parsed.data.key_value) {
    apiKey = parsed.data.key_value;
  } else {
    const { data: row, error: fetchError } = await locals.supabase
      .from('user_api_keys')
      .select('encrypted_key')
      .eq('id', parsed.data.id as string)
      .eq('user_id', locals.user.id)
      .single();

    if (fetchError || !row) {
      return apiError({ code: 'NOT_FOUND', status: 404, message: 'Klucz nie istnieje.' });
    }

    try {
      apiKey = await decryptWithEnvKey(row.encrypted_key);
    } catch {
      return apiResponse({ data: { result: 'error', models: [] } });
    }
  }

  const { ok, models } = await listModels(parsed.data.provider, apiKey, baseUrl);

  return apiResponse({ data: { result: ok ? 'ok' : 'error', models } });
};
