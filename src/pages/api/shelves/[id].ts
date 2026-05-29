import type { APIRoute } from 'astro';
import { z } from 'zod';

import { UpdateShelfSchema, type ShelfDTO } from '../../../lib/shelves/schema';
import { apiError, apiResponse, parseUuidParam } from '../../../lib/http/response';

// Cloudflare Workers wymóg @astrojs/cloudflare przy output: 'server'.
export const prerender = false;

/**
 * PATCH /api/shelves/:id
 *
 * Update name + location dla user-owned półki. RLS scopes do `auth.uid()`;
 * próba update'u cudzej półki → no-op (0 rows updated) → 404. „Zakupione"
 * rename'u blokuje DB trigger `prevent_zakupione_rename` (P0001 → 400).
 *
 * Body: `{ name?, location? }` — przynajmniej jedno pole wymagane.
 */
export const PATCH: APIRoute = async ({ request, params, locals }) => {
  const id = parseUuidParam(params.id);
  if (!id) {
    // 404 dla zniekształconego UUID (privacy: nie wyciekamy kształtu ID).
    return apiError({
      code: 'NOT_FOUND',
      status: 404,
      message: 'Półka nie istnieje.',
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

  const parsed = UpdateShelfSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Invalid shelf input.',
      details: z.flattenError(parsed.error),
    });
  }

  const patch: { name?: string; location?: string | null } = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.location !== undefined) {
    patch.location = parsed.data.location ?? null;
  }

  const { data, error } = await locals.supabase
    .from('shelves')
    .update(patch)
    .eq('id', id)
    .select('id, name, location, position_index, created_at')
    .single();

  if (error) {
    // P0001 = nasze `raise exception` z trigger'a `prevent_zakupione_rename`.
    if (error.code === 'P0001') {
      return apiError({
        code: 'VALIDATION_ERROR',
        status: 400,
        message: error.message,
      });
    }
    // 23505 = unique violation (user już ma półkę o tej nazwie).
    if (error.code === '23505') {
      return apiError({
        code: 'VALIDATION_ERROR',
        status: 400,
        message: 'Półka o tej nazwie już istnieje.',
      });
    }
    // PGRST116 = no rows (Supabase REST gdy .single() i 0 rows).
    if (error.code === 'PGRST116') {
      return apiError({
        code: 'NOT_FOUND',
        status: 404,
        message: 'Półka nie istnieje.',
      });
    }
    console.error('[api/shelves PATCH] supabase update failed', {
      name: error.name,
      message: error.message,
      code: error.code,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się zaktualizować półki.',
    });
  }

  const shelf: ShelfDTO = {
    id: data.id,
    name: data.name,
    location: data.location,
    position_index: data.position_index,
    is_system: data.name === 'Zakupione',
    book_count: 0, // PATCH nie potrzebuje realnego count — zwraca 0, GET list wylicza JS-tally
    created_at: data.created_at,
  };

  return apiResponse({ data: { shelf } });
};

/**
 * DELETE /api/shelves/:id
 *
 * Usuwa user-owned półkę. „Zakupione" blokuje DB trigger
 * `prevent_zakupione_delete` (P0001 → 400). RLS scope: próba delete'u cudzej
 * półki = 0 rows → 404.
 *
 * Zwraca 200 + `{data:{deleted:true}}` zamiast 204 (F-02 envelope wymaga
 * `{data}` w shape — spójność > brak ciała).
 */
export const DELETE: APIRoute = async ({ params, locals }) => {
  const id = parseUuidParam(params.id);
  if (!id) {
    return apiError({
      code: 'NOT_FOUND',
      status: 404,
      message: 'Półka nie istnieje.',
    });
  }

  // Najpierw select dla weryfikacji existence + RLS scope (zwraca 0 jeśli
  // cudza/nie-istnieje; pozwala odróżnić 404 od trigger reject).
  const { data: existing, error: selectError } = await locals.supabase
    .from('shelves')
    .select('id')
    .eq('id', id)
    .maybeSingle();

  if (selectError) {
    console.error('[api/shelves DELETE] pre-check select failed', {
      name: selectError.name,
      message: selectError.message,
      code: selectError.code,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się sprawdzić półki.',
    });
  }

  if (!existing) {
    return apiError({
      code: 'NOT_FOUND',
      status: 404,
      message: 'Półka nie istnieje.',
    });
  }

  const { error } = await locals.supabase.from('shelves').delete().eq('id', id);

  if (error) {
    // P0001 = trigger reject („Zakupione" niesuwalna).
    if (error.code === 'P0001') {
      return apiError({
        code: 'VALIDATION_ERROR',
        status: 400,
        message: error.message,
      });
    }
    console.error('[api/shelves DELETE] supabase delete failed', {
      name: error.name,
      message: error.message,
      code: error.code,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się usunąć półki.',
    });
  }

  return apiResponse({ data: { deleted: true } });
};
