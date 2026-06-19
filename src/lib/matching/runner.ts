import { searchGoogleBooks } from '../books/googleBooks';
import { searchOpenLibrary } from '../books/openLibrary';
import { searchNationalLibrary } from '../books/nationalLibrary';
import { scoreCandidate, MATCH_MID } from './score';
import { dedupeCandidates, checkCatalogDuplicate, type CatalogDuplicate } from './dedupe';
import type { BookCandidate, ScoredCandidate } from '../books/schema';

// Google Books QPS limit: even with API key, 35 simultaneous requests cause 429s.
export const MATCH_CONCURRENCY = 5;

const MAX_CANDIDATES = 5;

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

  // GB + Biblioteka Narodowa równolegle. BN ma natywne pokrycie polskich edycji
  // (recall, którego brakuje GB). Nie robimy early-return na porażce GB — BN może
  // mieć kandydatów mimo pustego/rate-limited GB.
  const [googleResult, bnResult] = await Promise.all([
    searchGoogleBooks({ title: rawTitle, author: rawAuthor }),
    searchNationalLibrary({ title: rawTitle, author: rawAuthor }),
  ]);

  const allCandidates: BookCandidate[] = [
    ...(googleResult.ok ? googleResult.candidates : []),
    ...(bnResult.ok ? bnResult.candidates : []),
  ];

  // Rate-limited tylko gdy GB rate-limited ORAZ brak kandydatów (BN też pusty) —
  // zachowuje retry. Gdy BN dostarczył kandydatów, idziemy dalej mimo GB 429.
  if (allCandidates.length === 0) {
    return {
      candidates: [],
      duplicate: null,
      rateLimited: !googleResult.ok && googleResult.reason === 'rate_limited',
    };
  }

  // OL ISBN-enrichment: only when ISBN available from gathered candidates (GB or BN)
  const firstIsbn =
    allCandidates.find((c) => c.isbn13)?.isbn13 ??
    allCandidates.find((c) => c.isbn10)?.isbn10 ??
    null;

  if (firstIsbn) {
    const olResult = await searchOpenLibrary({ title: rawTitle, isbn: firstIsbn });
    if (olResult.ok) allCandidates.push(...olResult.candidates);
  }

  const detForScore = { raw_title: rawTitle, raw_author: rawAuthor };
  const scored: ScoredCandidate[] = allCandidates.map((c) => ({
    ...c,
    matchScore: scoreCandidate(detForScore, {
      title: c.title,
      authors: c.authors,
      isbn13: c.isbn13,
      isbn10: c.isbn10,
    }),
  }));

  // Próg jakości: kandydaci poniżej MATCH_MID (0.55) to "brak pewnego matchu"
  // (PRD §10 + CLAUDE.md). Odrzucamy ich, by detekcja pokazała ścieżkę
  // "Wpisz ręcznie" zamiast fałszywej propozycji (np. antologia 48%, śmieci 25%).
  // Filtr PRZED dedupe/slice — inaczej top-5 zapełniłyby się szumem.
  const aboveThreshold = scored.filter((c) => c.matchScore >= MATCH_MID);
  const deduped = dedupeCandidates(aboveThreshold).slice(0, MAX_CANDIDATES);

  // Enrich candidates missing a cover but having an ISBN with OL ISBN cover URL.
  // OL covers endpoint works by ISBN even when search result lacks cover_i.
  const topCandidates = deduped.map((c) => {
    if (c.coverUrl) return c;
    const isbn = c.isbn13 ?? c.isbn10;
    if (!isbn) return c;
    return { ...c, coverUrl: `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false` };
  });

  const duplicate =
    topCandidates.length > 0 ? checkCatalogDuplicate(topCandidates[0], existingBooks) : null;

  return { candidates: topCandidates, duplicate, rateLimited: false };
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
          onProgress?.({
            index: ++completed,
            total,
            detectionId: det.id,
            title: det.raw_title ?? '',
          });
          return result;
        }),
    ),
    concurrency,
  );
}
