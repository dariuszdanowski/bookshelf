import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../db/database.types';

/**
 * Nazwa systemowej wirtualnej półki „Zakupione" — tworzona przy signup
 * (handle_new_user, 0003), niesuwalna/niezmienialna (0004). Source of truth
 * dla literału (dedupe z RESERVED_NAMES w shelves/schema.ts).
 */
export const PURCHASED_SHELF_NAME = 'Zakupione';

/**
 * Zwraca shelf_id półki „Zakupione" zalogowanego usera (RLS-scoped).
 * Null gdy nie znaleziono — w praktyce nie powinno się zdarzyć (signup ją
 * tworzy), więc call-site mapuje null → 500 INTERNAL_ERROR (stan nieoczekiwany).
 */
export async function getPurchasedShelfId(
  supabase: SupabaseClient<Database>
): Promise<string | null> {
  const { data, error } = await supabase
    .from('shelves')
    .select('id')
    .eq('name', PURCHASED_SHELF_NAME)
    .maybeSingle();

  if (error || !data) return null;
  return data.id;
}
