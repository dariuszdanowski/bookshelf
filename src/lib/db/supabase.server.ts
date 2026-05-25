import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { APIContext } from 'astro';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from './database.types';

/**
 * Minimalny kontrakt kontekstu Astro, którego potrzebuje klient: czyta cookies
 * z przychodzącego żądania i zapisuje odświeżone tokeny na odpowiedzi.
 * `APIContext` (endpointy) i `AstroGlobal` (strony `.astro`) oba go spełniają.
 */
type SupabaseServerContext = {
  request: Request;
  cookies: APIContext['cookies'];
};

/**
 * Request-scoped, typowany klient Supabase dla SSR (strony `.astro` i — później —
 * endpointy API). Egzekwuje RLS przez JWT usera z cookies; anon key, zero
 * service-role. To domyślna ścieżka dostępu do danych per-user.
 *
 * Tworzymy nowy klient na każdy render — nigdy nie współdzielimy go między
 * żądaniami (kontrakt `@supabase/ssr`).
 */
export function createServerSupabaseClient(
  context: SupabaseServerContext
): SupabaseClient<Database> {
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Brak PUBLIC_SUPABASE_URL lub PUBLIC_SUPABASE_ANON_KEY w środowisku — uzupełnij .env.local (zob. .env.example).'
    );
  }

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      // Astro `AstroCookies` nie eksponuje `getAll()`, więc czytamy nagłówek
      // `Cookie` żądania; `parseCookieHeader` zwraca `value?: string`, więc
      // dociągamy je do `string` pod kontrakt `getAll` z `@supabase/ssr`.
      getAll() {
        return parseCookieHeader(context.request.headers.get('Cookie') ?? '').map(
          ({ name, value }) => ({ name, value: value ?? '' })
        );
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          context.cookies.set(name, value, options)
        );
      },
    },
  });
}
