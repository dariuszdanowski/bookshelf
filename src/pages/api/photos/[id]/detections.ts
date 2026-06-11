import { z } from 'zod';
import type { APIRoute } from 'astro';

import { apiError, apiResponse, parseUuidParam } from '../../../../lib/http/response';
import type { DetectionWithCandidatesDTO } from '../../../../lib/photos/schema';

export const prerender = false;

const CreateDetectionSchema = z
  .object({
    title: z.string().trim().max(300).optional(),
    author: z.string().trim().max(200).optional(),
    bbox: z
      .object({
        x1: z.number().min(0).max(1),
        y1: z.number().min(0).max(1),
        x2: z.number().min(0).max(1),
        y2: z.number().min(0).max(1),
      })
      .optional(),
  })
  .refine((d) => d.title !== undefined || d.bbox !== undefined, {
    message: 'Wymagany co najmniej tytuł lub bbox.',
  })
  .refine((d) => !d.bbox || (d.bbox.x1 < d.bbox.x2 && d.bbox.y1 < d.bbox.y2), {
    message: 'x1 < x2 i y1 < y2 wymagane',
  });

/**
 * POST /api/photos/[id]/detections
 *
 * Tworzy nową detekcję ręcznie — przez wpis tytułu (identity-first, bez bbox)
 * lub przez narysowany bbox (tryb naprawczy). Co najmniej jedno z: title, bbox.
 * raw_title = title z body (lub '' gdy brak), status='pending'.
 * 200: { data: DetectionWithCandidatesDTO }
 * 400: brak title i bbox, lub nieprawidłowe bbox coords
 * 401: brak auth
 * 404: foto nie istnieje lub cudze
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const photoId = parseUuidParam(params.id);
  if (!photoId) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono zdjęcia.' });
  }

  // Verify photo ownership (RLS scoped)
  const { data: photo } = await locals.supabase
    .from('photos')
    .select('id')
    .eq('id', photoId)
    .maybeSingle();

  if (!photo) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono zdjęcia.' });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError({ code: 'VALIDATION_ERROR', status: 400, message: 'Nieprawidłowe JSON body.' });
  }

  const parsed = CreateDetectionSchema.safeParse(body);
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error);
    const first =
      flat.formErrors[0] ?? Object.values(flat.fieldErrors)[0]?.[0] ?? 'Nieprawidłowe dane.';
    return apiError({ code: 'VALIDATION_ERROR', status: 400, message: first });
  }

  const { bbox, title, author } = parsed.data;

  // Get latest vision_run_id — lub utwórz manual run jeśli żadnego nie ma
  const { data: visionRuns } = await locals.supabase
    .from('vision_runs')
    .select('id')
    .eq('photo_id', photoId)
    .order('created_at', { ascending: false })
    .limit(1);

  let visionRunId: string;
  if (visionRuns && visionRuns.length > 0) {
    visionRunId = visionRuns[0].id as string;
  } else {
    const { data: newRun, error: runErr } = await locals.supabase
      .from('vision_runs')
      .insert({ photo_id: photoId, model: 'manual', status: 'succeeded' })
      .select('id')
      .single();
    if (runErr || !newRun) {
      console.error('[api/photos detections POST] auto-create manual vision_run failed', runErr);
      return apiError({
        code: 'INTERNAL_ERROR',
        status: 500,
        message: 'Nie udało się utworzyć detekcji.',
      });
    }
    visionRunId = newRun.id as string;
  }

  // Get next position_index
  const { data: maxRows } = await locals.supabase
    .from('detections')
    .select('position_index')
    .eq('photo_id', photoId)
    .order('position_index', { ascending: false })
    .limit(1);

  const nextPosition =
    maxRows && maxRows.length > 0 ? (maxRows[0].position_index as number) + 1 : 1;

  // Insert new detection
  const { data: inserted, error: insertError } = await locals.supabase
    .from('detections')
    .insert({
      photo_id: photoId,
      position_index: nextPosition,
      raw_title: title ?? '',
      raw_author: author ?? null,
      vision_confidence: null,
      spine_color: null,
      status: 'pending',
      bbox_x1: bbox?.x1 ?? null,
      bbox_y1: bbox?.y1 ?? null,
      bbox_x2: bbox?.x2 ?? null,
      bbox_y2: bbox?.y2 ?? null,
      vision_run_id: visionRunId,
    })
    .select(
      'id, position_index, raw_title, raw_author, vision_confidence, spine_color, status, bbox_x1, bbox_y1, bbox_x2, bbox_y2, bbox_quad',
    )
    .single();

  if (insertError || !inserted) {
    console.error('[api/photos detections POST] insert failed', {
      name: insertError?.name,
      message: insertError?.message,
      code: insertError?.code,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się utworzyć detekcji.',
    });
  }

  const result: DetectionWithCandidatesDTO = {
    id: inserted.id as string,
    position_index: inserted.position_index as number,
    raw_title: (inserted.raw_title as string) ?? '',
    raw_author: (inserted.raw_author as string | null) ?? null,
    vision_confidence: (inserted.vision_confidence as number | null) ?? null,
    spine_color: (inserted.spine_color as string | null) ?? null,
    bbox:
      inserted.bbox_x1 != null
        ? {
            x1: inserted.bbox_x1 as number,
            y1: inserted.bbox_y1 as number,
            x2: inserted.bbox_x2 as number,
            y2: inserted.bbox_y2 as number,
          }
        : null,
    quad: null,
    status: inserted.status as string,
    candidates: [],
    duplicate: null,
  };

  return apiResponse({ data: result });
};
