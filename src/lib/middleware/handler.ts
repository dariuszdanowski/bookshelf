import type { APIContext, MiddlewareNext } from 'astro';
import type { AuthUser } from '@supabase/supabase-js';

import { createServerSupabaseClient } from '../db/supabase.server';
import { apiError } from '../http/response';

/**
 * Whitelist ścieżek nie wymagających sesji. Default secure — wszystko poza tą
 * listą wymaga zalogowanego usera (strony → redirect do /login, /api/* → 401).
 *
 * EXACT = pełen match pathname (`/login/foo` nie jest publiczne mimo `/login`
 * na liście). PREFIX = match po prefiksie (`/api/auth/login`,
 * `/api/auth/signup` → match na `/api/auth/`).
 */
const PUBLIC_EXACT = new Set(['/', '/login', '/signup']);
const PUBLIC_PREFIXES = ['/api/auth/'] as const;

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Core middleware logic — wydzielona z `src/middleware.ts` żeby była testowalna
 * w izolacji. `src/middleware.ts` to thin wrapper z `defineMiddleware`
 * (`astro:middleware` to virtual module dostępny tylko w Astro build/dev —
 * w Vitest nie da się go resolvować, lessons.md: „Adaptacje literalne").
 */
export async function handleRequest(
  context: APIContext,
  next: MiddlewareNext
): Promise<Response> {
  const supabase = createServerSupabaseClient(context);

  let user: AuthUser | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch (err) {
    // Treat-as-anon + log (PRD guardrail: brak utraty danych po awarii;
    // refresh przez user naprawia transient blip).
    console.error('[middleware] auth.getUser failed', {
      path: context.url.pathname,
      err,
    });
    user = null;
  }

  context.locals.supabase = supabase;
  context.locals.user = user;

  if (isPublicPath(context.url.pathname)) {
    return next();
  }

  if (!user) {
    if (context.url.pathname.startsWith('/api/')) {
      return apiError({
        code: 'UNAUTHENTICATED',
        status: 401,
        message: 'Authentication required.',
      });
    }
    return context.redirect('/login');
  }

  return next();
}
