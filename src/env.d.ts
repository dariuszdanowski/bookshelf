/// <reference types="astro/client" />

/**
 * Cloudflare Worker bindings (secrets z Worker Dashboard).
 *
 * Augmentujemy `Cloudflare.Env` przez `declare namespace Cloudflare`, bo
 * wrangler typegen (`worker-configuration.d.ts`) NIE wie o runtime secrets —
 * generuje tylko `interface Env extends __BaseEnv_Env { ASSETS: Fetcher }`.
 * Module augmentation tutaj scali się z generated, `import { env } from
 * 'cloudflare:workers'` (canonical Astro v6+ pattern — `Astro.locals.runtime.env`
 * usunięte w Astro v6) typuje wszystkie 4 secrets.
 *
 * Source-of-truth wartości: Cloudflare Worker Dashboard Secrets (server-side
 * runtime) + GitHub Repository Secrets (PUBLIC_* dla browser build-time
 * inlining). Zob. CLAUDE.md § Cloudflare adapter.
 */
declare namespace Cloudflare {
  interface Env {
    PUBLIC_SUPABASE_URL: string;
    PUBLIC_SUPABASE_ANON_KEY: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
    ANTHROPIC_API_KEY: string;
    GOOGLE_BOOKS_API_KEY?: string;
  }
}

/**
 * Astro `App.Locals` shape — zapełniane per request przez `src/middleware.ts`.
 *
 * Oba pola są **required** (nie optional), bo middleware ZAWSZE je ustawia
 * przed dotarciem żądania do handlera. To eliminuje konieczność
 * `if (!locals.supabase)` w każdym konsumencie. Inline `import(...)` żeby plik
 * pozostał script (ambient declaration), nie module — namespace działa globalnie.
 */
declare namespace App {
  interface Locals {
    supabase: import('@supabase/supabase-js').SupabaseClient<
      import('./lib/db/database.types').Database
    >;
    user: import('@supabase/supabase-js').AuthUser | null;
  }
}
