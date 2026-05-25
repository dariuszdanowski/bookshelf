/// <reference types="astro/client" />

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
