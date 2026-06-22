import { findBookCandidates } from './findCandidates';
import { checkCatalogDuplicate, type CatalogDuplicate } from './dedupe';
import type { ScoredCandidate } from '../books/schema';

// Google Books QPS limit: even with API key, 35 simultaneous requests cause 429s.
export const MATCH_CONCURRENCY = 5;

export type DetectionRow = {
  id: string;
  raw_title: string | null;
  raw_author: string | null;
  status: string;
  position_index: number;
};

export type ExistingBook = {
  id: string;
  title: string;
  authors: string[];
  isbn_13: string | null;
  isbn_10: string | null;
};

export type MatchResult = {
  candidates: ScoredCandidate[];
  duplicate: CatalogDuplicate;
  rateLimited: boolean;
};

export type MatchProgressEvent = {
  index: number;
  total: number;
  detectionId: string;
  title: string;
  matched: boolean;
  candidateTitle?: string;
  candidateAuthors?: string[];
};

export type OnMatchProgressFn = (event: MatchProgressEvent) => void;

/**
 * Runs tasks with a bounded concurrency pool — no external dependency needed.
 * Preserves original order and returns the same PromiseSettledResult[] shape
 * as Promise.allSettled so callers are interchangeable.
 */
export async function settledWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;

  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      try {
        results[i] = { status: 'fulfilled', value: await tasks[i]() };
      } catch (e) {
        results[i] = { status: 'rejected', reason: e };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

export async function matchDetection(
  detection: DetectionRow,
  existingBooks: ExistingBook[],
): Promise<MatchResult> {
  const rawTitle = detection.raw_title ?? '';
  const rawAuthor = detection.raw_author ?? null;

  // Używamy tej samej funkcji co rematch (/detections/[id]/rematch) — próg
  // SEARCH_MIN_SCORE (0.25) zamiast MATCH_MID (0.55), plus authorTokensMatch.
  // Niższy próg pozwala uchwycić tytuły seryjne gdzie OCR czyta tylko część
  // (np. "Zepsuta krew" z pełnego "Grzeczna dziewczynka. Zepsuta krew") —
  // score 0.45 byłby odrzucony przez 0.55, ale BN kandydat jest poprawny.
  const { candidates, rateLimited } = await findBookCandidates(rawTitle, rawAuthor, null);

  const duplicate =
    candidates.length > 0 ? checkCatalogDuplicate(candidates[0], existingBooks) : null;

  return { candidates, duplicate, rateLimited };
}

/**
 * Runs matching for all detections with bounded concurrency and optional progress callback.
 * Progress fires after each detection completes (success or rate-limited).
 */
export async function runMatchingWithProgress(
  detectionRows: DetectionRow[],
  catalog: ExistingBook[],
  concurrency: number,
  onProgress?: OnMatchProgressFn,
): Promise<PromiseSettledResult<MatchResult>[]> {
  let completed = 0;
  const total = detectionRows.length;
  return settledWithConcurrency(
    detectionRows.map(
      (det) => () =>
        matchDetection(det, catalog).then((result) => {
          const top = result.candidates[0];
          onProgress?.({
            index: ++completed,
            total,
            detectionId: det.id,
            title: det.raw_title ?? '',
            matched: result.candidates.length > 0 && !result.rateLimited,
            candidateTitle: top?.title,
            candidateAuthors: top?.authors,
          });
          return result;
        }),
    ),
    concurrency,
  );
}
