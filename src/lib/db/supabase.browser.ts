import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from './database.types';

/**
 * Typowany klient Supabase dla wysp React po stronie przeglądarki.
 *
 * Używa wyłącznie anon key — RLS jest egzekwowany przez sesję usera (JWT w
 * cookies zarządzanych przez `@supabase/ssr`). Żadnego service-role: klient
 * przeglądarkowy nie ma prawa omijać polityk per-user.
 *
 * Env reading: wyłącznie przez `import.meta.env.PUBLIC_*` (Vite build-time
 * inlining). W odróżnieniu od `supabase.server.ts` (który czyta `env` z
 * `'cloudflare:workers'` virtual module — server-only Workers binding),
 * browser bundle NIE ma dostępu do runtime bindings — wartości MUSZĄ być
 * zainline'owane przez Vite na etapie buildu. Wymaga `PUBLIC_SUPABASE_URL` +
 * `PUBLIC_SUPABASE_ANON_KEY` w GitHub Actions build env (zob.
 * `.github/workflows/deploy.yml`).
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
