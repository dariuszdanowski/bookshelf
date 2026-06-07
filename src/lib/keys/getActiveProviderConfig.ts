import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../db/database.types';
import type { VisionProviderConfig } from '../vision/client';
import { decryptWithEnvKey } from './crypto';

export async function getActiveProviderConfig(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<VisionProviderConfig | null> {
  const { data: row, error } = await supabase
    .from('user_api_keys')
    .select('id, provider, encrypted_key, model, base_url')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

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
    provider: row.provider,
    apiKey,
    model: row.model,
    baseUrl: row.base_url,
    // M27: id klucza do atrybucji kosztów (vision_runs/refine_calls.api_key_id)
    keyId: row.id,
  };
}
