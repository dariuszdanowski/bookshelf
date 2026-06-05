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
  industryIdentifiers: z
    .array(z.object({ type: z.string(), identifier: z.string() }))
    .optional(),
  imageLinks: z
    .object({ thumbnail: z.string().optional(), smallThumbnail: z.string().optional() })
    .optional(),
});

const GoogleBooksResponseSchema = z.object({
  items: z.array(z.object({ id: z.string(), volumeInfo: VolumeInfoSchema })).optional(),
});

type SearchQuery = { title: string; author?: string | null; isbn?: string | null };

function getApiKey(): string | null {
  return env?.GOOGLE_BOOKS_API_KEY ?? import.meta.env.GOOGLE_BOOKS_API_KEY ?? null;
}

function buildUrl(q: string, apiKey: string | null): string {
  const params = new URLSearchParams({ q, printType: 'books', maxResults: '10', country: 'PL' });
  if (apiKey) params.set('key', apiKey);
  return `${GOOGLE_BOOKS_BASE}?${params.toString()}`;
}

function mapItem(item: { id: string; volumeInfo: z.infer<typeof VolumeInfoSchema> }): BookCandidate {
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
  };
}

async function fetchBooks(url: string): Promise<BookSearchResult> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (e) {
    console.error('[googleBooks] network error', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, reason: 'network' };
  }

  if (response.status === 429) return { ok: false, reason: 'rate_limited' };

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
      buildUrl(`intitle:"${cleanTitle}"+inauthor:"${cleanAuthor}"`, apiKey)
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

  return lastResult;
}
