import type { APIContext, MiddlewareNext } from 'astro';
import type { AuthUser } from '@supabase/supabase-js';

import { createServerSupabaseClient } from '../db/supabase.server';
import { detectDbEnvironment, getSupabaseUrl, ENV_LABEL } from '../db/environment';
import { apiError } from '../http/response';

/**
 * Jednorazowy banner przy pierwszym requeście — żeby przy `npm run dev:host`
 * od razu było widać do którego Supabase jesteśmy podpięci (local vs prod).
 * Module-level flag bo Astro nie ma natywnego on-server-start hooka; pierwszy
 * request middleware = pierwsza okazja do logu w runtime.
 */
let bannerLogged = false;
function logEnvBannerOnce(): void {
  if (bannerLogged) return;
  bannerLogged = true;
  const dbEnv = detectDbEnvironment();
  const url = getSupabaseUrl();
  const marker = dbEnv === 'prod' ? '!!!' : '   ';
  const line = '='.repeat(60);
  console.log(`\n${line}`);
  console.log(`${marker} Supabase target: ${ENV_LABEL[dbEnv]}`);
  console.log(`${marker} URL: ${url || '(brak URL!)'}`);
  if (dbEnv === 'prod') {
    console.log(`${marker} UWAGA: mutacje idą na PRODUKCJĘ`);
  }
  console.log(`${line}\n`);
}

/**
 * Whitelist ścieżek nie wymagających sesji. Default secure — wszystko poza tą
 * listą wymaga zalogowanego usera (strony → redirect do /login, /api/* → 401).
 *
 * EXACT = pełen match pathname (`/login/foo` nie jest publiczne mimo `/login`
 * na liście). PREFIX = match po prefiksie (`/api/auth/login`,
 * `/api/auth/signup` → match na `/api/auth/`).
 */
const PUBLIC_EXACT = new Set(['/', '/login', '/signup', '/api/health']);
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
  logEnvBannerOnce();

  // Bootstrap może paść przy missing env (createServerSupabaseClient rzuca
  // czytelnym Error'em). Bez catch raw 500 omija envelope contract dla /api/.
  // Strony pozwalamy padać do Astro default 500 page (brak envelope contract
  // dla stron, plus deweloper widzi prawdziwy stacktrace).
  let supabase;
  try {
    supabase = createServerSupabaseClient(context);
  } catch (err) {
    console.error('[middleware] bootstrap failed', {
      path: context.url.pathname,
      err: err instanceof Error ? err.message : String(err),
    });
    if (context.url.pathname.startsWith('/api/')) {
      return apiError({
        code: 'INTERNAL_ERROR',
        status: 500,
        message: 'Service temporarily unavailable.',
      });
    }
    throw err;
  }

  let user: AuthUser | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch (err) {
    // Treat-as-anon + log (PRD guardrail: brak utraty danych po awarii;
    // refresh przez user naprawia transient blip).
    console.error('[middleware] auth.getUser failed', {
      path: context.url.pathname,
      err: err instanceof Error ? err.message : String(err),
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
