import type { APIRoute } from 'astro';

import { CostEventsQuerySchema } from '../../../lib/account/schema';
import { apiError, apiResponse } from '../../../lib/http/response';

export const prerender = false;

const PAGE_SIZE = 25;

/**
 * GET /api/account/costs?key&type&period&page
 *
 * Paginowana lista zdarzeń kosztowych z widoku `cost_events` (migracja 0021)
 * + suma kosztów dla aktywnego filtra.
 *
 * `(locals.supabase as any)`: widok cost_events nie jest w database.types.ts
 * — types regen dopiero po `db push` na prod (precedens stats.ts:14-16).
 *
 * Filtry:
 *   key=<uuid>  → eq('api_key_id', uuid)
 *   key=none    → is('api_key_id', null)
 *   type=vision|refine → eq('kind', ...)
 *   period=7d|30d → gte('created_at', ISO now-X)
 */
export const GET: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const url = new URL(request.url);
  const raw = {
    key: url.searchParams.get('key') ?? undefined,
    type: url.searchParams.get('type') ?? undefined,
    period: url.searchParams.get('period') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
  };

  const parsed = CostEventsQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Nieprawidłowe parametry zapytania.',
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const { key, type, period, page } = parsed.data;
  const userId = locals.user.id;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = locals.supabase as any;

  /** Aplikuje wspólne filtry do buildera zapytania. */
  function applyFilters(q: unknown): unknown {
    let builder = q as Record<string, (...args: unknown[]) => unknown>;
    builder = builder.eq('user_id', userId) as typeof builder;

    if (key === 'none') {
      builder = builder.is('api_key_id', null) as typeof builder;
    } else if (key !== undefined) {
      builder = builder.eq('api_key_id', key) as typeof builder;
    }

    if (type !== undefined) {
      builder = builder.eq('kind', type) as typeof builder;
    }

    if (period !== undefined) {
      const ms = period === '7d' ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
      const cutoff = new Date(Date.now() - ms).toISOString();
      builder = builder.gte('created_at', cutoff) as typeof builder;
    }

    return builder;
  }

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // (a) Strona: sortowanie + paginacja + count dokładny
  const pageQuery = applyFilters(
    sb
      .from('cost_events')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
  );

  type CostEventRow = {
    id: string;
    kind: string;
    model: string | null;
    cost_usd: number | null;
    latency_ms: number | null;
    created_at: string;
    api_key_id: string | null;
    photo_id: string | null;
    detection_id: string | null;
    raw_title: string | null;
  };
  type PageResult = {
    data: CostEventRow[] | null;
    count: number | null;
    error: { message: string } | null;
  };

  const pageResult = (await pageQuery) as PageResult;

  if (pageResult.error) {
    console.error('[api/account/costs GET] page query failed', {
      message: pageResult.error.message,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd pobierania kosztów.' });
  }

  // (b) Suma: bez paginacji, tylko cost_usd (wzorzec stats.ts)
  const sumQuery = applyFilters(sb.from('cost_events').select('cost_usd'));
  type SumResult = {
    data: { cost_usd: number | null }[] | null;
    error: { message: string } | null;
  };
  const sumResult = (await sumQuery) as SumResult;

  if (sumResult.error) {
    console.error('[api/account/costs GET] sum query failed', {
      message: sumResult.error.message,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Błąd pobierania sumy kosztów.',
    });
  }

  const totalCost = (sumResult.data ?? []).reduce((s, r) => s + (r.cost_usd ?? 0), 0);
  const totalCount = pageResult.count ?? 0;

  return apiResponse({
    data: {
      items: (pageResult.data ?? []).map((r) => ({
        id: r.id,
        kind: r.kind as 'vision' | 'refine',
        model: r.model,
        cost_usd: r.cost_usd,
        latency_ms: r.latency_ms,
        created_at: r.created_at,
        api_key_id: r.api_key_id,
        photo_id: r.photo_id,
        detection_id: r.detection_id,
        raw_title: r.raw_title,
      })),
      page,
      page_size: PAGE_SIZE,
      total_count: totalCount,
      total_cost_usd: totalCost,
    },
  });
};
