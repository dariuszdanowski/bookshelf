import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/lib/books/googleBooks', () => ({ searchGoogleBooks: vi.fn() }));
vi.mock('../../../../src/lib/books/openLibrary', () => ({
  searchOpenLibrary: vi.fn(),
  searchOpenLibraryByTitle: vi.fn(),
}));
vi.mock('../../../../src/lib/books/nationalLibrary', () => ({ searchNationalLibrary: vi.fn() }));

import { findBookCandidates } from '../../../../src/lib/matching/findCandidates';
import { searchGoogleBooks } from '../../../../src/lib/books/googleBooks';
import { searchOpenLibraryByTitle } from '../../../../src/lib/books/openLibrary';
import { searchOpenLibrary } from '../../../../src/lib/books/openLibrary';
import { searchNationalLibrary } from '../../../../src/lib/books/nationalLibrary';

// "Gorbledword" (11 chars) > "Koszmar" (7 chars)
// extractSignificantWords zwraca ["Gorbledword", "Koszmar"] — najdłuższe pierwsze
const GARBLED_TITLE = 'Gorbledword Koszmar';
const AUTHOR = 'Marowska';

const makeCandidate = (title: string, externalId = 'gb-1') => ({
  source: 'google_books' as const,
  externalId,
  title,
  authors: [AUTHOR],
  isbn10: null,
  isbn13: null,
  publisher: null,
  publishedYear: null,
  coverUrl: null,
  description: null,
});

// Różny tytuł + ten sam autor → score ~0.42 < MATCH_MID (0.55)
const LOW_SCORE_CANDIDATE = makeCandidate('Zupelnie Inna Ksiazka', 'gb-low');
// Dokładnie taki sam tytuł + autor → score ~0.95 ≥ MATCH_MID
const HIGH_SCORE_CANDIDATE = makeCandidate('Gorbledword Koszmar', 'gb-high');

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(searchGoogleBooks).mockResolvedValue({ ok: false, reason: 'empty' });
  vi.mocked(searchOpenLibraryByTitle).mockResolvedValue({ ok: false, reason: 'empty' });
  vi.mocked(searchNationalLibrary).mockResolvedValue({ ok: false, reason: 'empty' });
  vi.mocked(searchOpenLibrary).mockResolvedValue({ ok: false, reason: 'empty' });
});

describe('findBookCandidates — word-level OCR fallback', () => {
  it('garbled tytuł + autor → fallback próbuje słowa tytułu sekwencyjnie do pierwszego trafienia', async () => {
    vi.mocked(searchGoogleBooks)
      .mockResolvedValueOnce({ ok: true, candidates: [LOW_SCORE_CANDIDATE] }) // primary
      .mockResolvedValueOnce({ ok: false, reason: 'empty' }) // "Gorbledword" — brak
      .mockResolvedValueOnce({ ok: true, candidates: [HIGH_SCORE_CANDIDATE] }); // "Koszmar" — trafienie

    const { candidates } = await findBookCandidates(GARBLED_TITLE, AUTHOR, null);
    expect(searchGoogleBooks).toHaveBeenCalledTimes(3);
    expect(candidates.some((c) => c.title === HIGH_SCORE_CANDIDATE.title)).toBe(true);
  });

  it('primary match ≥ MATCH_MID → fallback nie wywołany', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({
      ok: true,
      candidates: [HIGH_SCORE_CANDIDATE],
    });

    const { candidates } = await findBookCandidates(GARBLED_TITLE, AUTHOR, null);
    expect(searchGoogleBooks).toHaveBeenCalledTimes(1);
    expect(candidates[0].title).toBe(HIGH_SCORE_CANDIDATE.title);
  });

  it('rawAuthor null → fallback pominięty', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({ ok: true, candidates: [LOW_SCORE_CANDIDATE] });

    await findBookCandidates(GARBLED_TITLE, null, null);
    expect(searchGoogleBooks).toHaveBeenCalledTimes(1);
  });

  it('wszystkie słowa tytułu < 5 znaków → brak słów, fallback pominięty', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({ ok: true, candidates: [LOW_SCORE_CANDIDATE] });

    // "Lem" (3) + "Lub" (3) — oba < WORD_FALLBACK_MIN_LEN (5)
    await findBookCandidates('Lem Lub', AUTHOR, null);
    expect(searchGoogleBooks).toHaveBeenCalledTimes(1);
  });

  it('GB rate-limited w fallbacku → break, rateLimited false (nie propaguje z fallbacku)', async () => {
    vi.mocked(searchGoogleBooks)
      .mockResolvedValueOnce({ ok: true, candidates: [LOW_SCORE_CANDIDATE] }) // primary
      .mockResolvedValueOnce({ ok: false, reason: 'rate_limited' }); // "Gorbledword" — 429

    const { rateLimited } = await findBookCandidates(GARBLED_TITLE, AUTHOR, null);
    expect(searchGoogleBooks).toHaveBeenCalledTimes(2);
    expect(rateLimited).toBe(false);
  });

  it('pierwsze słowo zwraca ≥ MATCH_MID → early stop, drugie słowo nie wywołane', async () => {
    vi.mocked(searchGoogleBooks)
      .mockResolvedValueOnce({ ok: true, candidates: [LOW_SCORE_CANDIDATE] }) // primary
      .mockResolvedValueOnce({ ok: true, candidates: [HIGH_SCORE_CANDIDATE] }); // "Gorbledword" — trafienie

    const { candidates } = await findBookCandidates(GARBLED_TITLE, AUTHOR, null);
    expect(searchGoogleBooks).toHaveBeenCalledTimes(2);
    expect(candidates.some((c) => c.title === HIGH_SCORE_CANDIDATE.title)).toBe(true);
  });
});
