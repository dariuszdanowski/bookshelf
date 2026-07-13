import type { APIRoute } from 'astro';

import { apiError, apiResponse, parseUuidParam } from '../../../../lib/http/response';

export const prerender = false;

type CorrectionRow = {
  id: string;
  correction_type: string | null;
  original_raw_title: string | null;
  original_raw_author: string | null;
  corrected_title: string | null;
  corrected_authors: string[] | null;
  created_at: string;
};

/**
 * GET /api/detections/[id]/history
 *
 * Chronologiczna historia korekt (corrections) dla jednej detekcji —
 * co było odczytane pierwotnie vs na co zostało skorygowane, kiedy i jakim
 * mechanizmem (weak-match-resolve-and-ocr-audit).
 */
export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const detectionId = parseUuidParam(params.id);
  if (!detectionId) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono detekcji.' });
  }

  const { data: detection, error: detectionError } = await locals.supabase
    .from('detections')
    .select('id')
    .eq('id', detectionId)
    .maybeSingle();

  if (detectionError) {
    console.error('[api/detections/history GET] detection select failed', {
      name: detectionError.name,
      message: detectionError.message,
      code: detectionError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd pobierania detekcji.' });
  }
  if (!detection) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono detekcji.' });
  }

  // original_raw_author (migracja 0028) może nie być jeszcze w committowanym
  // database.types.ts do czasu regeneracji — defensywny retry na 42703, wzorzec
  // S-50 (account/stats.ts::selectCosts()).
  const FULL_COLS =
    'id, correction_type, original_raw_title, original_raw_author, corrected_title, corrected_authors, created_at';
  const FALLBACK_COLS =
    'id, correction_type, original_raw_title, corrected_title, corrected_authors, created_at';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = locals.supabase as any;
  let { data: corrections, error: correctionsError } = (await sb
    .from('corrections')
    .select(FULL_COLS)
    .eq('detection_id', detectionId)
    .order('created_at', { ascending: true })) as {
    data: CorrectionRow[] | null;
    error: { code?: string; message: string } | null;
  };

  if (correctionsError?.code === '42703') {
    const retry = (await sb
      .from('corrections')
      .select(FALLBACK_COLS)
      .eq('detection_id', detectionId)
      .order('created_at', { ascending: true })) as {
      data: Array<Omit<CorrectionRow, 'original_raw_author'>> | null;
      error: { code?: string; message: string } | null;
    };
    corrections = (retry.data ?? []).map((row) => ({ ...row, original_raw_author: null }));
    correctionsError = retry.error;
  }

  if (correctionsError) {
    console.error(
      '[api/detections/history GET] corrections select failed',
      correctionsError.message,
    );
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd pobierania historii.' });
  }

  return apiResponse({
    data: {
      corrections: (corrections ?? []).map((row) => ({
        id: row.id,
        correction_type: row.correction_type,
        original_raw_title: row.original_raw_title,
        original_raw_author: row.original_raw_author,
        corrected_title: row.corrected_title,
        corrected_authors: row.corrected_authors,
        created_at: row.created_at,
      })),
    },
  });
};
