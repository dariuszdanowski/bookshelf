import { z } from 'zod';
import type { APIRoute } from 'astro';

import { apiError, apiResponse, parseUuidParam } from '../../../../lib/http/response';
import type { Json } from '../../../../lib/db/database.types';
import type { BboxCoords, QuadPoints } from '../../../../lib/photos/schema';

export const prerender = false;

const PointSchema = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);

const UpdateBboxSchema = z
  .object({
    bbox: z.object({
      x1: z.number().min(0).max(1),
      y1: z.number().min(0).max(1),
      x2: z.number().min(0).max(1),
      y2: z.number().min(0).max(1),
    }),
    quad: z.tuple([PointSchema, PointSchema, PointSchema, PointSchema]).nullable().optional(),
  })
  .refine((d) => d.bbox.x1 < d.bbox.x2 && d.bbox.y1 < d.bbox.y2, {
    message: 'x1 < x2 i y1 < y2 wymagane',
  });

/**
 * PATCH /api/detections/[id]/bbox
 *
 * Aktualizuje współrzędne bbox istniejącej detekcji (bez dotykania raw_title/status/candidates).
 * 200: { data: { id, bbox } }
 * 400: nieprawidłowe bbox (x1 >= x2 lub y1 >= y2)
 * 401: brak auth
 * 404: detekcja nie istnieje lub cudza
 */
export const PATCH: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const detectionId = parseUuidParam(params.id);
  if (!detectionId) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono detekcji.' });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError({ code: 'VALIDATION_ERROR', status: 400, message: 'Nieprawidłowe JSON body.' });
  }

  const parsed = UpdateBboxSchema.safeParse(body);
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error);
    const first =
      flat.formErrors[0] ?? Object.values(flat.fieldErrors)[0]?.[0] ?? 'Nieprawidłowe dane bbox.';
    return apiError({ code: 'VALIDATION_ERROR', status: 400, message: first });
  }

  const { bbox, quad = null } = parsed.data;

  const { data: rows, error } = await locals.supabase
    .from('detections')
    .update({
      bbox_x1: bbox.x1,
      bbox_y1: bbox.y1,
      bbox_x2: bbox.x2,
      bbox_y2: bbox.y2,
      bbox_quad: quad as Json | null,
    })
    .eq('id', detectionId)
    .select('id');

  if (error) {
    console.error('[api/detections bbox PATCH] update failed', {
      name: error.name,
      message: error.message,
      code: error.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd serwera.' });
  }

  if (!rows || rows.length === 0) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono detekcji.' });
  }

  const result: { id: string; bbox: BboxCoords; quad: QuadPoints | null } = {
    id: rows[0].id as string,
    bbox,
    quad: (quad as QuadPoints | null) ?? null,
  };
  return apiResponse({ data: result });
};
