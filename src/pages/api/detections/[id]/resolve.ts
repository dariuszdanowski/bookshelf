import type { APIRoute } from 'astro';

import type { ScoredCandidate } from '../../../../lib/books/schema';
import { apiError, apiResponse, parseUuidParam } from '../../../../lib/http/response';
import { getActiveProviderConfig } from '../../../../lib/keys/getActiveProviderConfig';
import { checkCatalogDuplicate } from '../../../../lib/matching/dedupe';
import { scoreCandidate } from '../../../../lib/matching/score';
import { isAiResolutionBudgetAvailable } from '../../../../lib/resolution/budgetPolicy';
import { resolveBookViaAI } from '../../../../lib/resolution/client';

export const prerender = false;

// Server-side floor — nawet gdy Claude zwróci status:'found', niska pewność
// jest traktowana jak not_found (obrona przed halucynacją, patrz plan §Krytyczne
// szczegóły implementacji).
const AI_RESOLUTION_CONFIDENCE_FLOOR = 0.5;

type ExistingBook = {
  id: string;
  title: string;
  authors: string[];
  isbn_13: string | null;
  isbn_10: string | null;
};

/**
 * POST /api/detections/[id]/resolve
 *
 * Ostatni poziom kaskady matchingu (S-50): dla detekcji bez żadnych kandydatów
 * woła Claude z web_search (klucz Anthropic usera, BYOK). Wynik trafia jako
 * zwykły book_candidates (source ai_resolution), re-scored przez scoreCandidate.
 * `shouldReplace` jest zawsze true — przycisk jest widoczny wyłącznie gdy
 * book_candidates.length === 0 dla tej detekcji.
 */
export const POST: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  const detectionId = parseUuidParam(params.id);
  if (!detectionId) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono detekcji.' });
  }

  // Guard: ai_enabled per profile (wzorzec S-26 z process.ts)
  const { data: profile } = await locals.supabase
    .from('profiles')
    .select('ai_enabled')
    .eq('id', locals.user.id)
    .single();
  if (!profile?.ai_enabled) {
    return apiError({
      code: 'AI_DISABLED',
      status: 403,
      message: 'Funkcje AI wyłączone dla tego konta.',
    });
  }

  const { data: detection, error: detectionError } = await locals.supabase
    .from('detections')
    .select('id, photo_id, raw_title, raw_author')
    .eq('id', detectionId)
    .maybeSingle();

  if (detectionError) {
    console.error('[api/detections/resolve POST] detection select failed', detectionError.message);
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd pobierania detekcji.' });
  }
  if (!detection) {
    return apiError({ code: 'NOT_FOUND', status: 404, message: 'Nie znaleziono detekcji.' });
  }

  const providerConfig = await getActiveProviderConfig(locals.supabase, locals.user.id);
  if (!providerConfig) {
    return apiError({
      code: 'NO_API_KEY',
      status: 403,
      message: 'Brak aktywnego klucza API. Dodaj klucz na stronie /account.',
      details: { account_url: '/account' },
    });
  }
  if (providerConfig.provider !== 'anthropic') {
    return apiError({
      code: 'AI_RESOLUTION_PROVIDER_UNSUPPORTED',
      status: 403,
      message:
        'Rozwiązanie przez AI wymaga aktywnego klucza Anthropic. Przełącz aktywny klucz na /account.',
      details: { account_url: '/account' },
    });
  }

  const userId = locals.user.id;
  // resolution_calls nie jest jeszcze w committowanym database.types.ts (Faza 1
  // §2) — dostęp przez `as any`, analogicznie do account/stats.ts::selectCosts().
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = locals.supabase as any;

  const todayStartUtc = new Date();
  todayStartUtc.setUTCHours(0, 0, 0, 0);

  const [dayCountResult, photoCountResult] = await Promise.all([
    sb
      .from('resolution_calls')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', todayStartUtc.toISOString()),
    sb
      .from('resolution_calls')
      .select('id', { count: 'exact', head: true })
      .eq('photo_id', detection.photo_id),
  ]);

  if (dayCountResult.error || photoCountResult.error) {
    console.error('[api/detections/resolve POST] budget count failed', {
      day: dayCountResult.error?.message,
      photo: photoCountResult.error?.message,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd sprawdzania budżetu.' });
  }

  const budgetAvailable = isAiResolutionBudgetAvailable({
    callsForDay: dayCountResult.count ?? 0,
    callsForPhoto: photoCountResult.count ?? 0,
  });
  if (!budgetAvailable) {
    return apiError({
      code: 'RESOLUTION_BUDGET_EXCEEDED',
      status: 429,
      message: 'Osiągnięto limit wywołań AI-resolution (per zdjęcie lub dzienny). Spróbuj później.',
    });
  }

  const outcome = await resolveBookViaAI(
    { rawTitle: detection.raw_title ?? '', rawAuthor: detection.raw_author },
    { apiKey: providerConfig.apiKey, model: providerConfig.model, keyId: providerConfig.keyId },
  );

  // Snapshot narrowed non-null values — TS narrowing on `detection`/`providerConfig`
  // (both `const`, checked above) doesn't carry into the nested function declaration.
  const photoId = detection.photo_id;
  const apiKeyId = providerConfig.keyId ?? null;
  const requestedModel = providerConfig.model ?? null;

  async function insertAudit(
    status: 'found' | 'not_found' | 'error',
    extra: {
      model?: string | null;
      costUsd?: number | null;
      searchCount?: number | null;
      latencyMs: number;
    },
  ) {
    const { error } = await sb.from('resolution_calls').insert({
      user_id: userId,
      photo_id: photoId,
      detection_id: detectionId,
      api_key_id: apiKeyId,
      model: extra.model ?? null,
      status,
      search_count: extra.searchCount ?? null,
      cost_usd: extra.costUsd ?? null,
      latency_ms: extra.latencyMs,
    });
    if (error) {
      console.error('[api/detections/resolve POST] resolution_calls insert failed', error.message);
    }
  }

  if (!outcome.ok) {
    await insertAudit('error', {
      model: requestedModel,
      latencyMs: outcome.latencyMs,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Błąd wywołania AI. Spróbuj ponownie.',
    });
  }

  const { result } = outcome;
  const lowConfidence =
    result.status === 'found' && result.confidence < AI_RESOLUTION_CONFIDENCE_FLOOR;

  if (result.status === 'not_found' || lowConfidence) {
    await insertAudit('not_found', {
      model: outcome.model,
      costUsd: outcome.costUsd,
      searchCount: outcome.searchCount,
      latencyMs: outcome.latencyMs,
    });
    await locals.supabase.from('corrections').insert({
      user_id: userId,
      detection_id: detectionId,
      original_raw_title: detection.raw_title,
      correction_type: 'ai_resolution_not_found',
    });
    return apiResponse({
      data: {
        applied: false,
        detection: { id: detectionId },
        candidates: [],
        duplicate: null,
        resolution: {
          status: 'not_found',
          reason:
            result.status === 'not_found'
              ? result.reason
              : 'AI znalazła wynik o zbyt niskiej pewności.',
        },
      },
    });
  }

  // result.status === 'found' i confidence >= floor
  await insertAudit('found', {
    model: outcome.model,
    costUsd: outcome.costUsd,
    searchCount: outcome.searchCount,
    latencyMs: outcome.latencyMs,
  });

  const candidateShape: Omit<ScoredCandidate, 'matchScore'> = {
    source: 'ai_resolution',
    externalId: `ai-resolution:${detectionId}`,
    title: result.title,
    authors: result.authors,
    isbn10: result.isbn10,
    isbn13: result.isbn13,
    publisher: result.publisher,
    publishedYear: result.publishedYear,
    coverUrl: null,
    description: null,
  };
  const matchScore = scoreCandidate(
    { raw_title: detection.raw_title ?? '', raw_author: detection.raw_author },
    candidateShape,
  );
  const scoredCandidate: ScoredCandidate = { ...candidateShape, matchScore };

  const { error: deleteError } = await locals.supabase
    .from('book_candidates')
    .delete()
    .eq('detection_id', detectionId);
  if (deleteError) {
    console.error('[api/detections/resolve POST] candidate delete failed', deleteError.message);
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd usuwania kandydatów.' });
  }

  const { data: inserted, error: insertError } = await locals.supabase
    .from('book_candidates')
    .insert({
      detection_id: detectionId,
      source: scoredCandidate.source,
      external_id: scoredCandidate.externalId,
      title: scoredCandidate.title,
      authors: scoredCandidate.authors,
      isbn_10: scoredCandidate.isbn10,
      isbn_13: scoredCandidate.isbn13,
      publisher: scoredCandidate.publisher,
      published_year: scoredCandidate.publishedYear,
      cover_url: scoredCandidate.coverUrl,
      description: scoredCandidate.description,
      match_score: scoredCandidate.matchScore,
      rank: 1,
    })
    .select(
      'id, source, external_id, title, authors, isbn_10, isbn_13, publisher, published_year, cover_url, match_score, rank',
    )
    .single();

  if (insertError || !inserted) {
    console.error('[api/detections/resolve POST] candidate insert failed', insertError?.message);
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Błąd zapisywania kandydata.',
    });
  }

  const { error: updateError } = await locals.supabase
    .from('detections')
    .update({ status: 'matched' })
    .eq('id', detectionId);
  if (updateError) {
    console.error(
      '[api/detections/resolve POST] detection status update failed',
      updateError.message,
    );
  }

  const { data: existingBooks } = await locals.supabase
    .from('books')
    .select('id, title, authors, isbn_13, isbn_10')
    .eq('user_id', userId);
  const catalog: ExistingBook[] = (existingBooks ?? []).map((b) => ({
    id: b.id,
    title: b.title,
    authors: b.authors,
    isbn_13: b.isbn_13,
    isbn_10: b.isbn_10,
  }));
  const duplicate = checkCatalogDuplicate(scoredCandidate, catalog);

  return apiResponse({
    data: {
      applied: true,
      detection: { id: detectionId, status: 'matched' },
      candidates: [
        {
          id: inserted.id,
          source: inserted.source,
          externalId: inserted.external_id,
          title: inserted.title,
          authors: inserted.authors,
          isbn10: inserted.isbn_10,
          isbn13: inserted.isbn_13,
          publisher: inserted.publisher,
          publishedYear: inserted.published_year,
          coverUrl: inserted.cover_url,
          matchScore: inserted.match_score,
          rank: inserted.rank,
        },
      ],
      duplicate,
      resolution: { status: 'found' },
    },
  });
};
