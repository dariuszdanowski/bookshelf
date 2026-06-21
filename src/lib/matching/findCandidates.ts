import type { BookCandidate, ScoredCandidate } from '../books/schema';
import { searchGoogleBooks } from '../books/googleBooks';
import { searchOpenLibrary, searchOpenLibraryByTitle } from '../books/openLibrary';
import { searchNationalLibrary } from '../books/nationalLibrary';
import { findCoverByIsbn } from '../books/cover';
import { scoreCandidate, authorTokensMatch } from './score';
import { dedupeCandidates } from './dedupe';

// Niższy próg niż MATCH_MID (0.55) — to świadome wyszukiwanie przez usera
// („Szukaj po tytule" / identyfikacja), który i tak wybiera ręcznie. Pozwala na
// cross-język (Keret po polsku vs angielskie GB — author match przechodzi).
export const SEARCH_MIN_SCORE = 0.25;
export const SEARCH_MAX_CANDIDATES = 8;

export type FindCandidatesOpts = {
  /** Gdy true i rawTitle puste: pomija title-score gate (SEARCH_MIN_SCORE).
   *  Pozwala zwrócić kandydatów dla zapytań „sam ISBN" gdzie titleSim=0 → score=0.20 < 0.25.
   *  Nie wpływa na zapytania z tytułem — gate aktywny jak dotychczas. */
  isbnOnly?: boolean;
  /** M22: wydawnictwo z grzbietu — zawęża kaskadę GB (`inpublisher:`); ścieżka ręczna. */
  publisher?: string | null;
};

/**
 * Wspólny silnik wyszukiwania kandydatów książek (GB + OpenLibrary + Biblioteka
 * Narodowa równolegle → score → filtr autora → dedup → enrich okładki). Czysta
 * funkcja (bez DB) — używana przez rematch detekcji i identyfikację książki.
 */
export async function findBookCandidates(
  rawTitle: string,
  rawAuthor: string | null,
  rawIsbn: string | null,
  opts?: FindCandidatesOpts,
): Promise<{ candidates: ScoredCandidate[]; rateLimited: boolean }> {
  const [googleResult, olTitleResult, bnResult] = await Promise.all([
    searchGoogleBooks({
      title: rawTitle,
      author: rawAuthor,
      isbn: rawIsbn ?? undefined,
      publisher: opts?.publisher ?? undefined,
    }),
    searchOpenLibraryByTitle({ title: rawTitle, author: rawAuthor }),
    searchNationalLibrary({ title: rawTitle, author: rawAuthor, isbn: rawIsbn ?? undefined }),
  ]);

  const allCandidates: BookCandidate[] = [
    ...(googleResult.ok ? googleResult.candidates : []),
    ...(olTitleResult.ok ? olTitleResult.candidates : []),
    ...(bnResult.ok ? bnResult.candidates : []),
  ];

  // OL ISBN lookup: najpierw user-supplied ISBN, potem z najlepszego kandydata GB.
  const isbnForOl =
    rawIsbn ??
    (googleResult.ok
      ? (googleResult.candidates.find((c) => c.isbn13)?.isbn13 ??
        googleResult.candidates.find((c) => c.isbn10)?.isbn10 ??
        null)
      : null);
  if (isbnForOl) {
    const olIsbnResult = await searchOpenLibrary({ title: rawTitle, isbn: isbnForOl });
    if (olIsbnResult.ok) allCandidates.push(...olIsbnResult.candidates);
  }

  // Rate-limited GB sygnalizujemy TYLKO gdy żadne źródło nie dało kandydatów
  // (OL/BN też puste) — zachowuje retry. Gdy fallback dostarczył wyniki, pokazujemy
  // je mimo GB 429 (PRD ryzyko #4: OpenLibrary jako fallback). Spójne z match.ts.
  if (allCandidates.length === 0) {
    return {
      candidates: [],
      rateLimited: !googleResult.ok && googleResult.reason === 'rate_limited',
    };
  }

  const scored: ScoredCandidate[] = allCandidates.map((c) => ({
    ...c,
    matchScore: scoreCandidate(
      { raw_title: rawTitle, raw_author: rawAuthor },
      { title: c.title, authors: c.authors, isbn13: c.isbn13, isbn10: c.isbn10 },
    ),
  }));

  scored.sort((a, b) => b.matchScore - a.matchScore);
  const skipScoreGate = opts?.isbnOnly && !rawTitle;
  const baseList = dedupeCandidates(
    scored.filter(
      (c) =>
        (skipScoreGate || c.matchScore >= SEARCH_MIN_SCORE) &&
        authorTokensMatch(rawAuthor, c.authors),
    ),
  ).slice(0, SEARCH_MAX_CANDIDATES);

  // Wzbogacenie okładki: HEAD do OL (verified, nie spekulatywny URL) + GB ISBN fallback.
  // Promise.all = równolegle dla max 8 kandydatów; HEAD OL ~100ms, GB ISBN ~500ms.
  const candidates = await Promise.all(
    baseList.map(async (c) => {
      if (c.coverUrl) return c;
      const isbn = c.isbn13 ?? c.isbn10;
      if (!isbn) return c;
      const coverUrl = await findCoverByIsbn(isbn, c.title);
      return { ...c, coverUrl };
    }),
  );

  return { candidates, rateLimited: false };
}
