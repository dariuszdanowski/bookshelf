import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../db/database.types';
import type { VisionProviderConfig } from '../vision/client';
import { decryptWithEnvKey } from './crypto';

export async function getActiveProviderConfig(
  supabase: SupabaseClient<Database>,
  userId: string,
  // per-call-byok-key-override: gdy podane, selectuje po id (ignorując is_active)
  // zamiast po is_active=true — pozwala na jednorazowy override aktywnego klucza.
  keyId?: string | null,
): Promise<VisionProviderConfig | null> {
  let query = supabase
    .from('user_api_keys')
    .select('id, provider, encrypted_key, model, base_url, request_timeout_ms, max_tokens_override')
    .eq('user_id', userId);
  query = keyId ? query.eq('id', keyId) : query.eq('is_active', true);
  const { data: row, error } = await query.maybeSingle();

  if (error) {
    console.error('[getActiveProviderConfig] DB error', error.message);
    return null;
  }

  if (!row) return null;

  let apiKey: string;
  try {
    apiKey = await decryptWithEnvKey(row.encrypted_key);
  } catch (err) {
    console.error(
      '[getActiveProviderConfig] decrypt failed',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }

  return {
    provider: row.provider as VisionProviderConfig['provider'],
    apiKey,
    model: row.model,
    baseUrl: row.base_url,
    // M27: id klucza do atrybucji kosztów (vision_runs/refine_calls.api_key_id)
    keyId: row.id,
    requestTimeoutMs: row.request_timeout_ms,
    maxTokensOverride: row.max_tokens_override,
  };
}
