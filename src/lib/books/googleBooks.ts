import { z } from 'zod';
import { env } from 'cloudflare:workers';

import type { BookCandidate, BookSearchResult } from './schema';
import { cleanSearchTitle, titleQueryVariants } from '../matching/normalizeQuery';

const GOOGLE_BOOKS_BASE = 'https://www.googleapis.com/books/v1/volumes';

const VolumeInfoSchema = z.object({
  title: z.string(),
  authors: z.array(z.string()).optional(),
  publisher: z.string().optional(),
  publishedDate: z.string().optional(),
  description: z.string().optional(),
  industryIdentifiers: z.array(z.object({ type: z.string(), identifier: z.string() })).optional(),
  imageLinks: z
    .object({ thumbnail: z.string().optional(), smallThumbnail: z.string().optional() })
    .optional(),
});

const GoogleBooksResponseSchema = z.object({
  items: z.array(z.object({ id: z.string(), volumeInfo: VolumeInfoSchema })).optional(),
});

type SearchQuery = {
  title: string;
  author?: string | null;
  isbn?: string | null;
  /** M22: wydawnictwo z grzbietu — zawęża wyniki przez `inpublisher:` (tylko ścieżka ręczna). */
  publisher?: string | null;
};

function getApiKey(): string | null {
  return env?.GOOGLE_BOOKS_API_KEY ?? import.meta.env.GOOGLE_BOOKS_API_KEY ?? null;
}

// „Krótki opis" (FR-032/S-17): GB potrafi zwrócić wielotysięczne opisy — przycinamy
// przy capture do 2000 znaków (search_text jest GENERATED STORED i rośnie per wiersz).
const DESCRIPTION_MAX = 2000;

function truncateDescription(s: string | undefined): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  return trimmed.length > DESCRIPTION_MAX ? trimmed.slice(0, DESCRIPTION_MAX) : trimmed;
}

function buildUrl(q: string, apiKey: string | null): string {
  const params = new URLSearchParams({ q, printType: 'books', maxResults: '10', country: 'PL' });
  if (apiKey) params.set('key', apiKey);
  return `${GOOGLE_BOOKS_BASE}?${params.toString()}`;
}

function mapItem(item: {
  id: string;
  volumeInfo: z.infer<typeof VolumeInfoSchema>;
}): BookCandidate {
  const info = item.volumeInfo;
  const isbns = info.industryIdentifiers ?? [];
  const isbn13 = isbns.find((i) => i.type === 'ISBN_13')?.identifier ?? null;
  const isbn10 = isbns.find((i) => i.type === 'ISBN_10')?.identifier ?? null;
  const publishedYear = info.publishedDate
    ? parseInt(info.publishedDate.slice(0, 4), 10) || null
    : null;
  const coverUrl = info.imageLinks?.thumbnail
    ? info.imageLinks.thumbnail.replace('http://', 'https://')
    : null;
  return {
    source: 'google_books',
    externalId: item.id,
    title: info.title,
    authors: info.authors ?? [],
    isbn10,
    isbn13,
    publisher: info.publisher ?? null,
    publishedYear,
    coverUrl,
    // S-17: opis z tej samej odpowiedzi search (zero dodatkowych requestów).
    description: truncateDescription(info.description),
  };
}

// S-39: 429 z GB to przejściowy limit QPS — bez retry burst /match (concurrency 5
// × N detekcji) po cichu gubił dopasowania (prod: 9/14 detekcji pending z 0 kandydatów
// na popularnych tytułach). Backoff + jitter rozprasza ponowienia.
export const RATE_LIMIT_RETRY_DELAYS_MS = [500, 1500] as const;
const RATE_LIMIT_JITTER_MS = 250;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function fetchBooks(url: string): Promise<BookSearchResult> {
  let response: Response | null = null;

  for (let attempt = 0; attempt <= RATE_LIMIT_RETRY_DELAYS_MS.length; attempt++) {
    try {
      response = await fetch(url);
    } catch (e) {
      console.error('[googleBooks] network error', {
        err: e instanceof Error ? e.message : String(e),
      });
      return { ok: false, reason: 'network' };
    }

    if (response.status !== 429) break;

    if (attempt === RATE_LIMIT_RETRY_DELAYS_MS.length) {
      return { ok: false, reason: 'rate_limited' };
    }
    await sleep(RATE_LIMIT_RETRY_DELAYS_MS[attempt] + Math.random() * RATE_LIMIT_JITTER_MS);
  }

  if (!response) return { ok: false, reason: 'network' }; // nieosiągalne — typ-guard

  if (!response.ok) {
    console.error('[googleBooks] HTTP error', { status: response.status });
    return { ok: false, reason: 'network' };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { ok: false, reason: 'network' };
  }

  const parsed = GoogleBooksResponseSchema.safeParse(data);
  if (!parsed.success) {
    console.error('[googleBooks] schema parse failed', JSON.stringify(parsed.error.issues));
    return { ok: false, reason: 'network' };
  }

  const items = parsed.data.items ?? [];
  if (items.length === 0) return { ok: false, reason: 'empty' };
  return { ok: true, candidates: items.map(mapItem) };
}

/**
 * Search Google Books with cascade query strategy:
 * 1. isbn: lookup (most precise) — stop on first non-empty result
 * 2. intitle: + inauthor: — if author available
 * 3. Free-text fallback (OCR-garbled friendly)
 * 4. inauthor: only — returns full author bibliography for cross-language scoring
 *    (e.g. Polish title vs English GB records — scorer ranks by author match)
 */
export async function searchGoogleBooks(query: SearchQuery): Promise<BookSearchResult> {
  const apiKey = getApiKey();

  if (query.isbn) {
    const result = await fetchBooks(buildUrl(`isbn:${query.isbn}`, apiKey));
    if (result.ok || result.reason === 'rate_limited') return result;
  }

  // Tytuł oczyszczony z homoglifów cyrylicy + zakresów lat (OCR-noise psuł match).
  const cleanTitle = cleanSearchTitle(query.title);
  const cleanAuthor = query.author ? cleanSearchTitle(query.author) : null;

  if (cleanAuthor) {
    const result = await fetchBooks(
      buildUrl(`intitle:"${cleanTitle}"+inauthor:"${cleanAuthor}"`, apiKey),
    );
    if (result.ok || result.reason === 'rate_limited') return result;
  }

  // intitle: bez autora — gdy intitle+inauthor nie dało wyników (np. OCR zgubił
  // literę w nazwisku: „Jedysek" zamiast „Jedrysek"). Tytuł z grzbietu jest często
  // bezbłędny; autor = dodatkowy sygnał, nie warunek konieczny znajdowania.
  // Robimy to PRZED publisher i free-text bo intitle: jest precyzyjniejsze.
  if (cleanAuthor) {
    const result = await fetchBooks(buildUrl(`intitle:"${cleanTitle}"`, apiKey));
    if (result.ok || result.reason === 'rate_limited') return result;
  }

  // M22: wydawnictwo (z grzbietu) zawęża wyniki, gdy autor i sam tytuł nie pomogły.
  const cleanPublisher = query.publisher ? cleanSearchTitle(query.publisher) : null;
  if (cleanPublisher) {
    const result = await fetchBooks(
      buildUrl(`intitle:"${cleanTitle}"+inpublisher:"${cleanPublisher}"`, apiKey),
    );
    if (result.ok || result.reason === 'rate_limited') return result;
  }

  // Kaskada free-text: pełny oczyszczony tytuł → główny człon (bez tomu/podtytułu).
  // Tylko 'empty' przechodzi do następnego wariantu; 'ok'/'rate_limited'/'network'
  // są terminalne (network = błąd transportu, nie powód by próbować węższe zapytanie).
  let lastResult: BookSearchResult = { ok: false, reason: 'empty' };
  for (const variant of titleQueryVariants(query.title)) {
    lastResult = await fetchBooks(buildUrl(variant, apiKey));
    if (lastResult.ok || lastResult.reason !== 'empty') return lastResult;
  }

  // Fallback inauthor: — zwraca bibliografię autora gdy tytuł nie dał wyników.
  // Przydatne dla tłumaczeń: "Usterka na skraju" → Keret bibliography w j. angielskim.
  // Scorer dopasuje po autorze (~0.30 wagi) nawet gdy titleSim jest niski.
  if (cleanAuthor) {
    const result = await fetchBooks(buildUrl(`inauthor:"${cleanAuthor}"`, apiKey));
    if (result.ok || result.reason === 'rate_limited') return result;
    lastResult = result;
  }

  return lastResult;
}
