import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/lib/books/googleBooks', () => ({ searchGoogleBooks: vi.fn() }));
vi.mock('../../../../src/lib/books/openLibrary', () => ({
  searchOpenLibrary: vi.fn(),
  searchOpenLibraryByTitle: vi.fn(),
}));
vi.mock('../../../../src/lib/books/nationalLibrary', () => ({ searchNationalLibrary: vi.fn() }));

import { findBookCandidates } from '../../../../src/lib/matching/findCandidates';
import { searchGoogleBooks } from '../../../../src/lib/books/googleBooks';
import { searchOpenLibrary, searchOpenLibraryByTitle } from '../../../../src/lib/books/openLibrary';
import { searchNationalLibrary } from '../../../../src/lib/books/nationalLibrary';

const ISBN = '9780156027601';
const GB_CANDIDATE = {
  source: 'google_books' as const,
  externalId: 'gb-1',
  title: 'Solaris',
  authors: ['Stanisław Lem'],
  isbn10: null,
  isbn13: ISBN,
  publisher: null,
  publishedYear: null,
  coverUrl: null,
  description: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(searchGoogleBooks).mockResolvedValue({ ok: false, reason: 'empty' });
  vi.mocked(searchOpenLibraryByTitle).mockResolvedValue({ ok: false, reason: 'empty' });
  vi.mocked(searchNationalLibrary).mockResolvedValue({ ok: false, reason: 'empty' });
  vi.mocked(searchOpenLibrary).mockResolvedValue({ ok: false, reason: 'empty' });
});

describe('findBookCandidates — ISBN-first path', () => {
  it('title puste + ISBN → zwraca kandydatów (ominięcie gate 0.25)', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({ ok: true, candidates: [GB_CANDIDATE] });
    const { candidates, rateLimited } = await findBookCandidates('', null, ISBN, {
      isbnOnly: true,
    });
    expect(rateLimited).toBe(false);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].title).toBe('Solaris');
  });

  it('title puste + ISBN bez flagi isbnOnly → pusta lista (gate 0.25 aktywny)', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({ ok: true, candidates: [GB_CANDIDATE] });
    const { candidates } = await findBookCandidates('', null, ISBN);
    expect(candidates).toEqual([]);
  });

  it('title niepuste → gate aktywny niezależnie od flagi', async () => {
    // Kandydat z zerowymi matchScore przejdzie gate tylko gdy isbnOnly=true ORAZ title=''
    vi.mocked(searchGoogleBooks).mockResolvedValue({ ok: true, candidates: [GB_CANDIDATE] });
    const { candidates } = await findBookCandidates('Solaris', null, ISBN, { isbnOnly: true });
    // Tytuł pasuje → score > 0.25 → kandydaci są niezależnie od flagi
    expect(candidates.length).toBeGreaterThan(0);
  });

  it('rate limited → rateLimited: true', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({ ok: false, reason: 'rate_limited' });
    const { rateLimited } = await findBookCandidates('', null, ISBN, { isbnOnly: true });
    expect(rateLimited).toBe(true);
  });
});
