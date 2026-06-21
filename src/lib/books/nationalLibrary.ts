import { z } from 'zod';

import type { BookCandidate, BookSearchResult } from './schema';
import { cleanSearchTitle, deCyrillic } from '../matching/normalizeQuery';

// Biblioteka Narodowa — otwarte API bibliograficzne (data.bn.org.pl).
// Darmowe, bez klucza, bez limitu. Natywne pokrycie polskich edycji — recall,
// którego brakuje Google Books (np. „Usterka na skraju galaktyki" Kereta).
//
// Diakrytyki: BN obsługuje polskie znaki w parametrze `title` poprawnie
// (zweryfikowane 2026-06-22: title=„Toast za Odważnych" → HTTP 200 + wynik;
// wcześniejszy zapis o HTTP 400 dla diakrytyków był błędny lub dotyczył
// starszego środowiska). Strategia: wysyłamy pełny tytuł z polskimi znakami;
// fallback z odfiltrowanymi diakrytykami aktywuje się tylko przy HTTP 400.

const BN_BASE = 'https://data.bn.org.pl/api/institutions/bibs.json';
const USER_AGENT = 'BookshelfCatalog/1.0 (https://github.com/dariuszdanowski/bookshelf)';
const BN_LIMIT = 5;

const DIACRITIC = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;

/** Słowa bez polskich diakrytyków — fallback gdy BN zwróci HTTP 400. */
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
  const title =
    trimMarc(marcSubfield(bib, '245', 'a')) ?? (bib.title ? bib.title.split(' / ')[0].trim() : '');
  const author = trimMarc(marcSubfield(bib, '100', 'a')); // 100$a = autor główny (700 = tłumacz — pomijamy)
  const isbnSources = [
    ...marcSubfieldAll(bib, '020', 'a'),
    ...(bib.isbnIssn ? bib.isbnIssn.split(/\s+/) : []),
  ];
  const { isbn13, isbn10 } = classifyIsbn(isbnSources);
  const publisher =
    trimMarc(marcSubfield(bib, '260', 'b')) ?? trimMarc(marcSubfield(bib, '264', 'b')) ?? null;
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
    // S-17: BN nie dostarcza opisów w danych bibliograficznych MARC.
    description: null,
  };
}

async function fetchBN(url: string): Promise<BookSearchResult> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  } catch (e) {
    console.error('[nationalLibrary] network error', {
      err: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, reason: 'network' };
  }
  if (response.status === 429) return { ok: false, reason: 'rate_limited' };
  // 400 = potencjalny bug filtra BN (stary gotcha, dziś rzadki) → traktuj jak
  // błąd sieciowy; wywołujący może spróbować fallback z bezpiecznym zapytaniem.
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
 * title + author. BN obsługuje polskie diakrytyki w `title` (zweryfikowane 2026-06-22),
 * więc wysyłamy pełny tytuł; fallback z safe query aktywuje się tylko przy HTTP 400.
 */
export async function searchNationalLibrary(query: {
  title: string;
  author?: string | null;
  isbn?: string | null;
}): Promise<BookSearchResult> {
  // ISBN: exact, niezawodne (cyfry — brak ryzyka 400).
  if (query.isbn) {
    const params = new URLSearchParams({
      isbnIssn: query.isbn.replace(/[-\s]/g, ''),
      limit: String(BN_LIMIT),
    });
    return fetchBN(`${BN_BASE}?${params.toString()}`);
  }

  // cleanSearchTitle zawiera deCyrillic — krytyczne dla BN: cyrylicki homoglif
  // (np. „Przytulajkа" z cyrylickim а U+0430) daje w BN 0 wyników, mimo że
  // książka jest pod łacińską pisownią. Zachowuje polskie diakrytyki (ą/ę/ó/...).
  const fullTitle = cleanSearchTitle(query.title);
  const fullAuthor = query.author ? deCyrillic(query.author) : '';

  if (fullTitle) {
    const params = new URLSearchParams({ title: fullTitle, limit: String(BN_LIMIT) });
    if (fullAuthor) params.set('author', fullAuthor);
    const result = await fetchBN(`${BN_BASE}?${params.toString()}`);
    // ok + empty + rate_limited → terminalne; network (incl. 400) → próbuj fallback
    if (result.ok || result.reason !== 'network') return result;
  }

  // Fallback: odfiltruj słowa z polskimi diakrytykami — na wypadek gdyby BN
  // zwróciło HTTP 400 dla konkretnego tytułu.
  const safeTitle = diacriticSafeQuery(fullTitle);
  if (!safeTitle) return { ok: false, reason: 'empty' };
  const safeAuthor = fullAuthor ? diacriticSafeQuery(fullAuthor) : '';
  const safeParams = new URLSearchParams({ title: safeTitle, limit: String(BN_LIMIT) });
  if (safeAuthor) safeParams.set('author', safeAuthor);
  return fetchBN(`${BN_BASE}?${safeParams.toString()}`);
}
