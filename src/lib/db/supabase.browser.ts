import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from './database.types';

/**
 * Typowany klient Supabase dla wysp React po stronie przeglądarki.
 *
 * Używa wyłącznie anon key — RLS jest egzekwowany przez sesję usera (JWT w
 * cookies zarządzanych przez `@supabase/ssr`). Żadnego service-role: klient
 * przeglądarkowy nie ma prawa omijać polityk per-user.
 */
export function createBrowserSupabaseClient(): SupabaseClient<Database> {
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Brak PUBLIC_SUPABASE_URL lub PUBLIC_SUPABASE_ANON_KEY w środowisku — uzupełnij .env.local (zob. .env.example).'
    );
  }

  return createBrowserClient<Database>(url, anonKey);
}
