import type { APIRoute } from 'astro';
import { z } from 'zod';
import { apiError, apiResponse } from '../../../lib/http/response';

export const prerender = false;

const PurchaseHintsQuerySchema = z.object({
  type: z.enum(['event', 'city']),
});

/**
 * GET /api/books/purchase-hints?type=event|city
 *
 * Zwraca unikalne wartości purchase_event lub purchase_city usera
 * do autocomplete w BookModal i PhotoPurchasePanel.
 *
 * 200: { data: { hints: string[] } }
 * 400: brak/zły parametr type
 * 401: niezalogowany
 */
export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const parsed = PurchaseHintsQuerySchema.safeParse({ type: url.searchParams.get('type') });
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Parametr type musi być "event" lub "city".',
      details: z.flattenError(parsed.error),
    });
  }

  const column = parsed.data.type === 'event' ? 'purchase_event' : 'purchase_city';

  const { data, error } = await locals.supabase
    .from('books')
    .select(column)
    .not(column, 'is', null)
    .order(column, { ascending: true })
    .limit(50);

  if (error) {
    console.error('[api/books/purchase-hints] supabase select failed', {
      name: error.name,
      message: error.message,
      code: error.code,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Błąd pobierania podpowiedzi.',
    });
  }

  // Dedup po stronie aplikacji (DISTINCT w PostgREST wymaga RPC lub widoku).
  const seen = new Set<string>();
  const hints: string[] = [];
  for (const row of data ?? []) {
    const val = (row as Record<string, unknown>)[column];
    if (typeof val === 'string' && !seen.has(val)) {
      seen.add(val);
      hints.push(val);
    }
  }

  return apiResponse({ data: { hints } });
};
