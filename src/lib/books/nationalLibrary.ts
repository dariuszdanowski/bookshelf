import { z } from 'zod';

import type { BookCandidate, BookSearchResult } from './schema';

// Biblioteka Narodowa — otwarte API bibliograficzne (data.bn.org.pl).
// Darmowe, bez klucza, bez limitu. Natywne pokrycie polskich edycji — recall,
// którego brakuje Google Books (np. „Usterka na skraju galaktyki" Kereta).
//
// Gotcha (zweryfikowane PoC 2026-06-05): filtr `title` zwraca HTTP 400 dla
// DOWOLNEGO polskiego diakrytyku (ź/ś/ż...), a strip diakrytyków psuje match
// (BN jest diacritic-sensitive). Rozwiązanie: do zapytania `title` bierzemy
// tylko BEZDIAKRYTYCZNE słowa tytułu — BN ma substring-match, więc i tak trafia
// („Wielki ogarniacz życia" → „Wielki ogarniacz" → ✓). Gdy 0 takich słów,
// pomijamy zapytanie tytułowe (ISBN/GB/OL pozostają). Ten sam guard na `author`.

const BN_BASE = 'https://data.bn.org.pl/api/institutions/bibs.json';
const USER_AGENT = 'BookshelfCatalog/1.0 (https://github.com/dariuszdanowski/bookshelf)';
const BN_LIMIT = 5;

const DIACRITIC = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;

/** Słowa bez polskich diakrytyków — bezpieczne dla buggy filtra BN (patrz wyżej). */
function diacriticSafeQuery(s: string): string {
  return s
    .split(/\s+/)
    .filter((w) => w.length > 0 && !DIACRITIC.test(w))
    .join(' ')
    .trim();
}

// --- MARC parsing -----------------------------------------------------------
// bib.marc.fields: tablica obiektów jednokluczowych {tag: value}. Dla pól
// kontrolnych value=string; dla pól danych value={ind1,ind2,subfields:[{code:val}]}.

const MarcDataFieldSchema = z.object({
  subfields: z.array(z.record(z.string(), z.string())).optional(),
});

const BibSchema = z.object({
  id: z.union([z.number(), z.string()]),
  isbnIssn: z.string().optional(),
  publisher: z.string().optional(),
  publicationYear: z.string().optional(),
  title: z.string().optional(),
  author: z.string().optional(),
  marc: z.object({ fields: z.array(z.record(z.string(), z.unknown())) }).optional(),
});

const BNResponseSchema = z.object({
  bibs: z.array(BibSchema).optional(),
});

type Bib = z.infer<typeof BibSchema>;

/** Pierwsza wartość subpola `code` z pierwszego pola `tag` w rekordzie MARC. */
function marcSubfield(bib: Bib, tag: string, code: string): string | null {
  for (const f of bib.marc?.fields ?? []) {
    const raw = f[tag];
    if (raw == null) continue;
    const parsed = MarcDataFieldSchema.safeParse(raw);
    if (!parsed.success) continue;
    for (const sf of parsed.data.subfields ?? []) {
      if (code in sf) return sf[code];
    }
  }
  return null;
}

/** Wszystkie wartości subpola `code` ze WSZYSTKICH pól `tag` (np. wiele 020). */
function marcSubfieldAll(bib: Bib, tag: string, code: string): string[] {
  const out: string[] = [];
  for (const f of bib.marc?.fields ?? []) {
    const raw = f[tag];
    if (raw == null) continue;
    const parsed = MarcDataFieldSchema.safeParse(raw);
    if (!parsed.success) continue;
    for (const sf of parsed.data.subfields ?? []) {
      if (code in sf) out.push(sf[code]);
    }
  }
  return out;
}

/** Zdejmuje końcowe znaki interpunkcji MARC (" /", " :", ",") z subpola. */
function trimMarc(s: string | null): string | null {
  if (s == null) return null;
  return s.replace(/\s*[/:,;]\s*$/, '').trim() || null;
}

function classifyIsbn(candidates: string[]): { isbn13: string | null; isbn10: string | null } {
  let isbn13: string | null = null;
  let isbn10: string | null = null;
  for (const raw of candidates) {
    const c = raw.replace(/[-\s]/g, '');
    if (!isbn13 && /^\d{13}$/.test(c)) isbn13 = c;
    else if (!isbn10 && /^\d{9}[\dX]$/.test(c)) isbn10 = c;
  }
  return { isbn13, isbn10 };
}

function mapBib(bib: Bib): BookCandidate {
  const title = trimMarc(marcSubfield(bib, '245', 'a')) ?? (bib.title ? bib.title.split(' / ')[0].trim() : '');
  const author = trimMarc(marcSubfield(bib, '100', 'a')); // 100$a = autor główny (700 = tłumacz — pomijamy)
  const isbnSources = [
    ...marcSubfieldAll(bib, '020', 'a'),
    ...(bib.isbnIssn ? bib.isbnIssn.split(/\s+/) : []),
  ];
  const { isbn13, isbn10 } = classifyIsbn(isbnSources);
  const publisher = trimMarc(marcSubfield(bib, '260', 'b')) ?? trimMarc(marcSubfield(bib, '264', 'b')) ?? null;
  const year = bib.publicationYear ? parseInt(bib.publicationYear, 10) : NaN;
  return {
    source: 'national_library',
    externalId: String(bib.id),
    title,
    authors: author ? [author] : [],
    isbn10,
    isbn13,
    publisher,
    publishedYear: Number.isFinite(year) && year >= 1000 && year <= 2100 ? year : null,
    // BN nie podaje okładek — enrichment przez OL po ISBN robi się downstream.
    coverUrl: null,
  };
}

async function fetchBN(url: string): Promise<BookSearchResult> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  } catch (e) {
    console.error('[nationalLibrary] network error', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, reason: 'network' };
  }
  if (response.status === 429) return { ok: false, reason: 'rate_limited' };
  // 400 = buggy filtr BN dla diakrytyków (mitygowane przez diacriticSafeQuery,
  // ale zostawiamy graceful guard) → traktuj jak brak wyników, nie crash.
  if (!response.ok) {
    if (response.status !== 400) {
      console.error('[nationalLibrary] HTTP error', { status: response.status });
    }
    return { ok: false, reason: 'network' };
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { ok: false, reason: 'network' };
  }
  const parsed = BNResponseSchema.safeParse(data);
  if (!parsed.success) {
    console.error('[nationalLibrary] schema parse failed', JSON.stringify(parsed.error.issues));
    return { ok: false, reason: 'network' };
  }
  const bibs = parsed.data.bibs ?? [];
  if (bibs.length === 0) return { ok: false, reason: 'empty' };
  return { ok: true, candidates: bibs.map(mapBib).filter((c) => c.title.length > 0) };
}

/**
 * Wyszukiwanie w Bibliotece Narodowej. ISBN (gdy podany) = exact lookup; inaczej
 * title + author z guardem na diakrytyki. Trzecie źródło równolegle z GB+OL.
 */
export async function searchNationalLibrary(query: {
  title: string;
  author?: string | null;
  isbn?: string | null;
}): Promise<BookSearchResult> {
  // ISBN: exact, niezawodne (cyfry — brak ryzyka 400).
  if (query.isbn) {
    const params = new URLSearchParams({ isbnIssn: query.isbn.replace(/[-\s]/g, ''), limit: String(BN_LIMIT) });
    return fetchBN(`${BN_BASE}?${params.toString()}`);
  }

  const safeTitle = diacriticSafeQuery(query.title);
  if (!safeTitle) return { ok: false, reason: 'empty' }; // tytuł w całości diakrytykowy — pomiń

  const params = new URLSearchParams({ title: safeTitle, limit: String(BN_LIMIT) });
  const safeAuthor = query.author ? diacriticSafeQuery(query.author) : '';
  if (safeAuthor) params.set('author', safeAuthor);
  return fetchBN(`${BN_BASE}?${params.toString()}`);
}
