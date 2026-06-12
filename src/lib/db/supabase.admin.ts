import { env } from 'cloudflare:workers';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from './database.types';

/**
 * Service-role Supabase client — omija RLS. Tworzony on-demand wyłącznie
 * w admin endpointach po przejściu requireAdmin guard.
 *
 * NIGDY nie wstrzykiwać do App.Locals ani nie eksponować przeglądarce.
 * autoRefreshToken i persistSession wyłączone — Worker handler ma krótki
 * cykl życia (per-request), token service-role nie wygasa.
 */
export function createAdminSupabaseClient(): SupabaseClient<Database> {
  const url = env?.PUBLIC_SUPABASE_URL ?? import.meta.env.PUBLIC_SUPABASE_URL;
  const serviceRoleKey =
    env?.SUPABASE_SERVICE_ROLE_KEY ?? import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      [
        'Brak PUBLIC_SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY w środowisku.',
        '— prod CF Workers: dodaj jako Secrets w Cloudflare Dashboard.',
        '— Astro dev: uzupełnij .dev.vars.',
        '— Vitest: vi.mock("cloudflare:workers", () => ({ env: { ... } }))',
      ].join('\n'),
    );
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
