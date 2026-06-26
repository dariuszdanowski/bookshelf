import type { APIRoute } from 'astro';

import { apiError, apiResponse } from '../../lib/http/response';

export const prerender = false;

/**
 * POST /api/client-log
 *
 * Przyjmuje logi diagnostyczne z przeglądarki i wyświetla je w server console
 * (widoczne w logach Cloudflare / lokalnym dev). Używane do debugowania błędów
 * client-side, które nie generują requestu do serwera (np. OOM przed uploadem).
 *
 * Body: { level: 'debug'|'warn'|'error', tag: string, message: string, data?: unknown }
 * Auth: opcjonalna — logujemy też niezalogowane błędy (np. crash przed auth check)
 */
export const POST: APIRoute = async ({ request, locals }) => {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError({ code: 'VALIDATION_ERROR', status: 400, message: 'Invalid JSON body.' });
  }

  if (!raw || typeof raw !== 'object') {
    return apiError({ code: 'VALIDATION_ERROR', status: 400, message: 'Expected JSON object.' });
  }

  const { level, tag, message, data } = raw as Record<string, unknown>;
  const userId = locals.user?.id ?? 'anon';
  const prefix = `[client-log uid=${userId}] [${String(level ?? 'debug')}] [${String(tag ?? '?')}]`;

  if (level === 'error') {
    console.error(prefix, String(message ?? ''), data ?? '');
  } else if (level === 'warn') {
    console.warn(prefix, String(message ?? ''), data ?? '');
  } else {
    console.log(prefix, String(message ?? ''), data ?? '');
  }

  return apiResponse({ data: { ok: true } });
};
