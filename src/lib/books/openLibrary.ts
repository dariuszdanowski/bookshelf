import { z } from 'zod';

import type { BookCandidate, BookSearchResult } from './schema';

const OL_BASE = 'https://openlibrary.org/search.json';
const USER_AGENT = 'BookshelfCatalog/1.0 (https://github.com/dariuszdanowski/bookshelf)';

const OLDocSchema = z.object({
  key: z.string(),
  title: z.string(),
  author_name: z.array(z.string()).optional(),
  first_publish_year: z.number().optional(),
  isbn: z.array(z.string()).optional(),
  cover_i: z.number().optional(),
  publisher: z.array(z.string()).optional(),
});

const OLResponseSchema = z.object({
  docs: z.array(OLDocSchema).optional(),
});

type SearchQuery = { title: string; author?: string | null; isbn?: string | null };

function extractIsbn(isbns: string[], length: 10 | 13): string | null {
  return isbns.find((i) => i.replace(/[-\s]/g, '').length === length) ?? null;
}

function mapDoc(doc: z.infer<typeof OLDocSchema>): BookCandidate {
  const isbns = doc.isbn ?? [];
  const isbn13 = extractIsbn(isbns, 13);
  const isbn10 = extractIsbn(isbns, 10);
  const coverUrl = doc.cover_i
    ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
    : (isbn13 ?? isbn10)
      ? `https://covers.openlibrary.org/b/isbn/${isbn13 ?? isbn10}-M.jpg?default=false`
      : null;
  return {
    source: 'open_library',
    externalId: doc.key,
    title: doc.title,
    authors: doc.author_name ?? [],
    isbn10,
    isbn13,
    publisher: doc.publisher?.[0] ?? null,
    publishedYear: doc.first_publish_year ?? null,
    coverUrl,
  };
}

/**
 * Search OpenLibrary by ISBN only.
 *
 * OL title-search returns 0 results for Polish titles → used exclusively for
 * ISBN-enrichment when an ISBN is already known (from detection or Google candidate).
 * Returns { ok: false, reason: 'empty' } immediately when no ISBN provided.
 */
export async function searchOpenLibrary(query: SearchQuery): Promise<BookSearchResult> {
  if (!query.isbn) return { ok: false, reason: 'empty' };

  const params = new URLSearchParams({
    isbn: query.isbn.replace(/[-\s]/g, ''),
    fields: 'key,title,author_name,first_publish_year,isbn,cover_i,publisher',
    limit: '5',
  });

  let response: Response;
  try {
    response = await fetch(`${OL_BASE}?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT },
    });
  } catch (e) {
    console.error('[openLibrary] network error', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, reason: 'network' };
  }

  if (response.status === 429) return { ok: false, reason: 'rate_limited' };

  if (!response.ok) {
    console.error('[openLibrary] HTTP error', { status: response.status });
    return { ok: false, reason: 'network' };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { ok: false, reason: 'network' };
  }

  const parsed = OLResponseSchema.safeParse(data);
  if (!parsed.success) {
    console.error('[openLibrary] schema parse failed', JSON.stringify(parsed.error.issues));
    return { ok: false, reason: 'network' };
  }

  const docs = parsed.data.docs ?? [];
  if (docs.length === 0) return { ok: false, reason: 'empty' };
  return { ok: true, candidates: docs.map(mapDoc) };
}
