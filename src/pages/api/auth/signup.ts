import type { APIRoute } from 'astro';
import { z } from 'zod';

import { SignupSchema } from '../../../lib/auth/schema';
import { apiError, apiResponse } from '../../../lib/http/response';

// Cloudflare Workers wymóg @astrojs/cloudflare przy output: 'server'.
export const prerender = false;

/**
 * POST /api/auth/signup
 *
 * Walidacja Zod input → supabase.auth.signUp z user_metadata.display_name →
 * trigger 0003 handle_new_user tworzy profiles + shelf „Zakupione".
 *
 * Auto-confirm musi być włączony w Supabase Dashboard (Auth → Settings →
 * Confirm email = off) — bez tego `data.user === null` po signUp i auto-login
 * (Q3) nie zadziała. Endpoint wykrywa ten stan i sygnalizuje operatorowi.
 *
 * Middleware whitelist'uje `/api/auth/*` — `locals.user` zwykle `null` (user
 * niezalogowany chce się zarejestrować). Endpoint używa wyłącznie
 * `locals.supabase` (request-scoped, RLS-respecting).
 */
export const POST: APIRoute = async ({ request, locals }) => {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Invalid JSON body.',
    });
  }

  const parsed = SignupSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Invalid signup input.',
      // Adaptacja vs plan: Zod v4 deprecated err.flatten(), używamy z.flattenError().
      details: z.flattenError(parsed.error),
    });
  }

  const { email, password, display_name } = parsed.data;

  let data: Awaited<
    ReturnType<typeof locals.supabase.auth.signUp>
  >['data'];
  let error: Awaited<
    ReturnType<typeof locals.supabase.auth.signUp>
  >['error'];
  try {
    const result = await locals.supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name } },
    });
    data = result.data;
    error = result.error;
  } catch (thrown) {
    // Jakiś wyjątek poza standardową obsługą Supabase (np. cookie setter
    // throw, fetch error w runtime CF Workers). Loguj rich kontekst do
    // Worker logs; klient dostaje generic 500 (privacy guardrail).
    console.error('[api/auth/signup] thrown exception during signUp', {
      name: thrown instanceof Error ? thrown.name : 'unknown',
      message: thrown instanceof Error ? thrown.message : String(thrown),
      stack:
        thrown instanceof Error && thrown.stack
          ? thrown.stack.split('\n').slice(0, 8).join('\n')
          : undefined,
      cause:
        thrown instanceof Error && 'cause' in thrown
          ? String((thrown as { cause?: unknown }).cause)
          : undefined,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Signup failed.',
    });
  }

  if (error) {
    const msg = error.message?.toLowerCase() ?? '';
    if (msg.includes('already') || msg.includes('registered')) {
      return apiError({
        code: 'VALIDATION_ERROR',
        status: 400,
        message: 'Email is already registered.',
      });
    }
    // Rich logging do Worker logs (operator visibility); klient generic 500
    // (privacy guardrail: nie wyciekamy szczegółów Supabase do response body).
    console.error('[api/auth/signup] supabase signUp failed', {
      name: error.name,
      message: error.message,
      status: error.status,
      code: 'code' in error ? error.code : undefined,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Signup failed.',
    });
  }

  // Auto-confirm wyłączony w Dashboard → data.user istnieje, ale data.session
  // jest null (user pending). Sygnalizujemy operatorowi że konfiguracja Q3
  // (auto-login) nie zadziała.
  if (!data.user) {
    console.error('[api/auth/signup] auto-confirm not configured', {
      hint: 'Supabase Dashboard → Auth → Settings → Confirm email = off',
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Auto-confirm not configured.',
    });
  }

  return apiResponse({ data: { redirect: '/' } });
};
