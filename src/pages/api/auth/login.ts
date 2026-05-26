import type { APIRoute } from 'astro';
import { z } from 'zod';

import { LoginSchema } from '../../../lib/auth/schema';
import { apiError, apiResponse } from '../../../lib/http/response';

export const prerender = false;

/**
 * POST /api/auth/login
 *
 * Walidacja Zod → signInWithPassword → success redirect, error 401 z
 * generic message (privacy: nie ujawniamy czy email istnieje).
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

  const parsed = LoginSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Invalid login input.',
      // Adaptacja vs plan: Zod v4 deprecated err.flatten(), używamy z.flattenError().
      details: z.flattenError(parsed.error),
    });
  }

  const { email, password } = parsed.data;

  const { data, error } = await locals.supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    // Supabase rozróżnia "Invalid login credentials" (status 400) od innych
    // (np. 500 z infra). Generic 401 dla credentials, brak statusu (status=null
    // przy network/transport blip), lub 401 → privacy-first 401. 5xx i inne
    // niespodzianki → 500. Privacy guardrail: nie potwierdzamy istnienia emaila.
    const status = typeof error.status === 'number' ? error.status : null;
    if (status === null || status === 400 || status === 401) {
      return apiError({
        code: 'UNAUTHENTICATED',
        status: 401,
        message: 'Invalid email or password.',
      });
    }
    console.error('[api/auth/login] supabase signIn failed', {
      err: error.message,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Login failed.',
    });
  }

  // Defensywnie: Supabase nie zwrócił error ale data.user puste — traktujemy
  // jak nieudany login (privacy: nie ujawniamy nietypowego stanu). Rzadki
  // edge case (zaobserwowany np. gdy Confirm email = on a user jeszcze nie
  // potwierdził). Cherry-pick z eksperymentu A/B/C wariantu C.
  if (!data.user) {
    return apiError({
      code: 'UNAUTHENTICATED',
      status: 401,
      message: 'Invalid email or password.',
    });
  }

  return apiResponse({ data: { redirect: '/' } });
};
