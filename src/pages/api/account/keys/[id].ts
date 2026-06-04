import type { APIRoute } from 'astro';
import { z } from 'zod';

import { encryptWithEnvKey } from '../../../../lib/keys/crypto';
import { UpdateKeySchema } from '../../../../lib/keys/schema';
import { apiError, apiResponse, parseUuidParam } from '../../../../lib/http/response';

export const prerender = false;

const KEY_SELECT = 'id,label,provider,model,base_url,is_active,last_tested_at,last_test_result,created_at';

/**
 * PATCH /api/account/keys/[id]
 * Aktualizuje label lub zmienia is_active. Gdy is_active=true: 2-krokowa
 * dezaktywacja innych → aktywacja wybranego. Partial unique index chroni przed
 * race conditions → 23505 → 400 VALIDATION_ERROR.
 */
export const PATCH: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const id = parseUuidParam(params.id);
  if (!id) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Klucz nie istnieje.' });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError({ code: 'VALIDATION_ERROR', status: 400, message: 'Invalid JSON body.' });
  }

  const parsed = UpdateKeySchema.safeParse(raw);
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Invalid update input.',
      details: z.flattenError(parsed.error),
    });
  }

  // Verify row exists and belongs to this user
  const { error: fetchError } = await locals.supabase
    .from('user_api_keys')
    .select('id,user_id')
    .eq('id', id)
    .eq('user_id', locals.user.id)
    .single();

  if (fetchError) {
    if (fetchError.code === 'PGRST116') {
      return apiError({ code: 'NOT_FOUND', status: 404, message: 'Klucz nie istnieje.' });
    }
    console.error('[api/account/keys/[id] PATCH] fetch failed', {
      name: fetchError.name,
      message: fetchError.message,
      code: fetchError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się zaktualizować klucza.' });
  }

  if (parsed.data.is_active === true) {
    // Dezaktywuj wszystkie inne klucze usera przed aktywacją wybranego
    const { error: deactivateError } = await locals.supabase
      .from('user_api_keys')
      .update({ is_active: false })
      .eq('user_id', locals.user.id)
      .neq('id', id);

    if (deactivateError) {
      console.error('[api/account/keys/[id] PATCH] deactivate others failed', {
        name: deactivateError.name,
        message: deactivateError.message,
        code: deactivateError.code,
      });
      return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się zaktualizować klucza.' });
    }
  }

  const updatePayload: {
    label?: string;
    is_active?: boolean;
    provider?: 'anthropic' | 'openai' | 'openrouter' | 'openai_compatible';
    model?: string | null;
    base_url?: string | null;
    encrypted_key?: string;
  } = {};
  if (parsed.data.label !== undefined) updatePayload.label = parsed.data.label;
  if (parsed.data.is_active !== undefined) updatePayload.is_active = parsed.data.is_active;
  if (parsed.data.provider !== undefined) updatePayload.provider = parsed.data.provider;
  if (parsed.data.model !== undefined) updatePayload.model = parsed.data.model ?? null;
  if (parsed.data.base_url !== undefined) updatePayload.base_url = parsed.data.base_url ?? null;
  if (parsed.data.key_value !== undefined) {
    updatePayload.encrypted_key = await encryptWithEnvKey(parsed.data.key_value);
  }

  const { data, error: updateError } = await locals.supabase
    .from('user_api_keys')
    .update(updatePayload)
    .eq('id', id)
    .eq('user_id', locals.user.id)
    .select(KEY_SELECT)
    .single();

  if (updateError) {
    if (updateError.code === '23505') {
      return apiError({
        code: 'VALIDATION_ERROR',
        status: 400,
        message: 'Inny klucz jest już aktywny.',
      });
    }
    if (updateError.code === 'PGRST116') {
      return apiError({ code: 'NOT_FOUND', status: 404, message: 'Klucz nie istnieje.' });
    }
    console.error('[api/account/keys/[id] PATCH] update failed', {
      name: updateError.name,
      message: updateError.message,
      code: updateError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się zaktualizować klucza.' });
  }

  return apiResponse({ data: { key: data } });
};

/**
 * DELETE /api/account/keys/[id]
 * Usuwa klucz. RLS + eq(user_id) gwarantuje brak dostępu do cudzych kluczy.
 */
export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const id = parseUuidParam(params.id);
  if (!id) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Klucz nie istnieje.' });
  }

  const { error, count } = await locals.supabase
    .from('user_api_keys')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('user_id', locals.user.id);

  if (error) {
    console.error('[api/account/keys/[id] DELETE] failed', {
      name: error.name,
      message: error.message,
      code: error.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Nie udało się usunąć klucza.' });
  }

  if (count === 0) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Klucz nie istnieje.' });
  }

  return apiResponse({ data: {} });
};
