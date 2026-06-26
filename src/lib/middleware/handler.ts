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
const PUBLIC_EXACT = new Set([
  '/',
  '/login',
  '/signup',
  '/api/health',
  '/api/client-log',
  '/help',
  '/logout',
]);
const PUBLIC_PREFIXES = ['/api/auth/'] as const;

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Per-request access log dla `/api/*`: kiedy (ISO), kto (user id + email),
 * co (metoda + ścieżka + query), wynik (status) i czas obsługi.
 *
 * Query z redakcją wrażliwych kluczy (token/code/secret/key/...). Ciała
 * requestów CELOWO nielogowane: (a) konsumpcja body zepsułaby downstream
 * endpoint, (b) ryzyko wycieku sekretów (klucz BYOK w POST /api/account/keys,
 * hasło w /api/auth/*). Logujemy tylko `/api/*` — strony/assety pomijamy (szum).
 */
const SENSITIVE_QUERY_KEY = /token|code|secret|password|key|jwt/i;
function redactQuery(search: string): string {
  if (!search) return '';
  const parts: string[] = [];
  for (const [k, v] of new URLSearchParams(search)) {
    parts.push(`${k}=${SENSITIVE_QUERY_KEY.test(k) ? '[redacted]' : v}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

function logApiRequest(
  context: APIContext,
  user: AuthUser | null,
  status: number,
  startedAt: number,
): void {
  const ms = Date.now() - startedAt;
  const who = user ? `${user.id} <${user.email ?? '?'}>` : 'anon';
  console.log(
    `[api] ${new Date().toISOString()} ${context.request.method} ${context.url.pathname}` +
      `${redactQuery(context.url.search)} user=${who} -> ${status} (${ms}ms)`,
  );
}

/**
 * Core middleware logic — wydzielona z `src/middleware.ts` żeby była testowalna
 * w izolacji. `src/middleware.ts` to thin wrapper z `defineMiddleware`
 * (`astro:middleware` to virtual module dostępny tylko w Astro build/dev —
 * w Vitest nie da się go resolvować, lessons.md: „Adaptacje literalne").
 */
export async function handleRequest(context: APIContext, next: MiddlewareNext): Promise<Response> {
  logEnvBannerOnce();
  const startedAt = Date.now();
  const isApi = context.url.pathname.startsWith('/api/');

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
    if (isApi) {
      logApiRequest(context, null, 500, startedAt);
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
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      // Expected for stale/expired browser sessions — treat as anon silently.
      // Non-auth errors (network, config) would throw and land in the catch below.
      user = null;
    } else {
      user = data.user;
    }
  } catch (err) {
    // Treat-as-anon + log only unexpected (non-auth) errors.
    const isExpectedAuthError = err != null && typeof err === 'object' && '__isAuthError' in err;
    if (!isExpectedAuthError) {
      console.error('[middleware] auth.getUser failed', {
        path: context.url.pathname,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    user = null;
  }

  context.locals.supabase = supabase;
  context.locals.user = user;

  if (!isPublicPath(context.url.pathname) && !user) {
    if (isApi) {
      logApiRequest(context, null, 401, startedAt);
      return apiError({
        code: 'UNAUTHENTICATED',
        status: 401,
        message: 'Authentication required.',
      });
    }
    return context.redirect('/login');
  }

  const response = await next();
  if (isApi) logApiRequest(context, user, response.status, startedAt);
  return response;
}
