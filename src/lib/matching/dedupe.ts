import type { ScoredCandidate } from '../books/schema';

export type CatalogDuplicate = { type: 'exact' | 'edition'; shelfHint?: string } | null;

type ExistingBook = {
  id: string;
  title: string;
  authors: string[];
  isbn_13: string | null;
  isbn_10: string | null;
};

function normStr(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

// Local Levenshtein — dedupe.ts has no dep on score.ts to keep modules independent
function lev(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = new Array<number>(n + 1);
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] =
        a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    prev = curr;
  }
  return prev[n];
}

function titleDist(a: string, b: string): number {
  return lev(normStr(a), normStr(b));
}

/**
 * Reconcile candidates from multiple sources (Google + OL):
 * - Same isbn_13 → keep higher score, prefer google_books on tie
 * - No isbn_13 → dedupe by normalized title distance < 3
 * Returns sorted by matchScore descending.
 */
export function dedupeCandidates(candidates: ScoredCandidate[]): ScoredCandidate[] {
  const byIsbn13 = new Map<string, ScoredCandidate>();
  const noIsbn: ScoredCandidate[] = [];

  for (const c of candidates) {
    if (c.isbn13) {
      const prev = byIsbn13.get(c.isbn13);
      if (!prev || c.matchScore > prev.matchScore ||
          (c.matchScore === prev.matchScore && c.source === 'google_books')) {
        byIsbn13.set(c.isbn13, c);
      }
    } else {
      noIsbn.push(c);
    }
  }

  const deduped: ScoredCandidate[] = [...byIsbn13.values()];

  for (const c of noIsbn) {
    const isDupe = deduped.some((e) => e.isbn13 == null && titleDist(c.title, e.title) < 3);
    if (!isDupe) deduped.push(c);
  }

  return deduped.sort((a, b) => b.matchScore - a.matchScore);
}

/**
 * Check whether a scored candidate is already in the user's catalog.
 * - exact: same isbn_13
 * - edition: fuzzy title match (dist < 3) with overlapping authors but different isbn
 * - null: not a duplicate
 */
export function checkCatalogDuplicate(
  candidate: ScoredCandidate,
  existingBooks: ExistingBook[]
): CatalogDuplicate {
  if (candidate.isbn13) {
    const exact = existingBooks.find((b) => b.isbn_13 === candidate.isbn13);
    if (exact) return { type: 'exact' };
  }

  const edition = existingBooks.find((b) => {
    if (titleDist(b.title, candidate.title) >= 3) return false;
    if (b.authors.length === 0 || candidate.authors.length === 0) return false;
    return b.authors.some((ba) =>
      candidate.authors.some((ca) => lev(normStr(ba), normStr(ca)) < 5)
    );
  });

  return edition ? { type: 'edition' } : null;
}
