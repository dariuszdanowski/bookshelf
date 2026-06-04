import type { APIRoute } from 'astro';
import { z } from 'zod';

import { encryptWithEnvKey } from '../../../../lib/keys/crypto';
import { CreateKeySchema } from '../../../../lib/keys/schema';
import { apiError, apiResponse } from '../../../../lib/http/response';

export const prerender = false;

const KEY_SELECT = 'id,label,provider,model,base_url,is_active,last_tested_at,last_test_result,created_at';

/**
 * GET /api/account/keys
 * Zwraca metadane kluczy bez encrypted_key.
 */
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const { data, error } = await locals.supabase
    .from('user_api_keys')
    .select(KEY_SELECT)
    .eq('user_id', locals.user.id)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[api/account/keys GET] supabase select failed', {
      name: error.name,
      message: error.message,
      code: error.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się pobrać kluczy.' });
  }

  return apiResponse({ data: { keys: data } });
};

/**
 * POST /api/account/keys
 * Tworzy nowy klucz. Szyfruje key_value przed insertem.
 * Plaintext nigdy nie wraca w odpowiedzi.
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

  const parsed = CreateKeySchema.safeParse(raw);
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Invalid key input.',
      details: z.flattenError(parsed.error),
    });
  }

  const { label, provider, key_value, model, base_url } = parsed.data;
  const encrypted_key = await encryptWithEnvKey(key_value);

  const { data, error } = await locals.supabase
    .from('user_api_keys')
    .insert({
      user_id: locals.user.id,
      label,
      provider,
      model: model ?? null,
      base_url: base_url ?? null,
      encrypted_key,
    })
    .select(KEY_SELECT)
    .single();

  if (error) {
    if (error.code === '23505') {
      return apiError({ code: 'VALIDATION_ERROR', status: 400, message: 'Klucz z tymi danymi już istnieje.' });
    }
    console.error('[api/account/keys POST] supabase insert failed', {
      name: error.name,
      message: error.message,
      code: error.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się dodać klucza.' });
  }

  return apiResponse({ data: { key: data }, status: 201 });
};
