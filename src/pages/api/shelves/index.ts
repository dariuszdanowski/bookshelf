import type { APIRoute } from 'astro';
import { z } from 'zod';

import { CreateShelfSchema, type ShelfDTO } from '../../../lib/shelves/schema';
import { apiError, apiResponse } from '../../../lib/http/response';

// Cloudflare Workers wymóg @astrojs/cloudflare przy output: 'server'.
export const prerender = false;

/**
 * GET /api/shelves
 *
 * Lista półek zalogowanego usera (middleware F-02 wymusza auth — anon dostaje
 * 401 przed dotarciem do tego handler'a). Sortowanie: „Zakupione" first, potem
 * name ASC.
 *
 * book_count: realny count z shelf_entries (is_current=true) pobierany
 * równolegle z shelves — JS-tally do Map<shelf_id, number>, bez N+1.
 * PostgREST nie wyraża GROUP BY count w jednym wywołaniu; JS agregacja
 * to idiom repo (analogicznie do candidatesByDetId Map w photos/[id].ts).
 */
export const GET: APIRoute = async ({ locals }) => {
  const [shelvesResult, entriesResult] = await Promise.all([
    locals.supabase
      .from('shelves')
      .select('id, name, location, position_index, created_at')
      .order('name', { ascending: true }),
    locals.supabase
      .from('shelf_entries')
      .select('shelf_id')
      .eq('is_current', true),
  ]);

  if (shelvesResult.error) {
    console.error('[api/shelves GET] supabase select failed', {
      name: shelvesResult.error.name,
      message: shelvesResult.error.message,
      code: 'code' in shelvesResult.error ? shelvesResult.error.code : undefined,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się pobrać listy półek.',
    });
  }

  if (entriesResult.error) {
    console.error('[api/shelves GET] shelf_entries select failed', {
      name: entriesResult.error.name,
      message: entriesResult.error.message,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się pobrać listy półek.',
    });
  }

  // Zlicz książki per półka w JS
  const countByShelf = new Map<string, number>();
  for (const row of (entriesResult.data ?? [])) {
    countByShelf.set(row.shelf_id, (countByShelf.get(row.shelf_id) ?? 0) + 1);
  }

  // Sort po stronie aplikacji żeby „Zakupione" zawsze first
  const sorted = [...(shelvesResult.data ?? [])].sort((a, b) => {
    if (a.name === 'Zakupione') return -1;
    if (b.name === 'Zakupione') return 1;
    return a.name.localeCompare(b.name, 'pl');
  });

  const shelves: ShelfDTO[] = sorted.map((row) => ({
    id: row.id,
    name: row.name,
    location: row.location,
    position_index: row.position_index,
    is_system: row.name === 'Zakupione',
    book_count: countByShelf.get(row.id) ?? 0,
    created_at: row.created_at,
  }));

  return apiResponse({ data: { shelves } });
};

/**
 * POST /api/shelves
 *
 * Tworzy nową półkę dla zalogowanego usera. Body: `{ name, location? }`.
 * RLS policy `shelves_insert_own` wymusza `user_id = auth.uid()` — endpoint
 * NIE filtruje ręcznie, RLS gwarantuje izolację per-user. Insert dodaje
 * `user_id: locals.user.id` explicitnie (middleware zapewnia że user nie-null).
 *
 * Postgres error mapping:
 * - `23505` (unique_violation) → 400 VALIDATION_ERROR „Półka o tej nazwie już istnieje"
 * - inne → 500 INTERNAL_ERROR
 */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    // Defensive — middleware już to filtruje, ale TS narrowing.
    return apiError({
      code: 'UNAUTHENTICATED',
      status: 401,
      message: 'Authentication required.',
    });
  }

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

  const parsed = CreateShelfSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Invalid shelf input.',
      details: z.flattenError(parsed.error),
    });
  }

  const { name, location } = parsed.data;

  const { data, error } = await locals.supabase
    .from('shelves')
    .insert({
      user_id: locals.user.id,
      name,
      location: location ?? null,
    })
    .select('id, name, location, position_index, created_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      return apiError({
        code: 'VALIDATION_ERROR',
        status: 400,
        message: 'Półka o tej nazwie już istnieje.',
      });
    }
    console.error('[api/shelves POST] supabase insert failed', {
      name: error.name,
      message: error.message,
      code: error.code,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się utworzyć półki.',
    });
  }

  const shelf: ShelfDTO = {
    id: data.id,
    name: data.name,
    location: data.location,
    position_index: data.position_index,
    is_system: false, // User-created nigdy nie jest systemowa (Zod refuse na 'Zakupione').
    book_count: 0,
    created_at: data.created_at,
  };

  return apiResponse({ data: { shelf }, status: 201 });
};
