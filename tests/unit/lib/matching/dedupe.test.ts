import { describe, expect, it } from 'vitest';
import { dedupeCandidates, checkCatalogDuplicate } from '../../../../src/lib/matching/dedupe';
import type { ScoredCandidate } from '../../../../src/lib/books/schema';

function makeCandidate(
  overrides: Partial<ScoredCandidate> & { matchScore: number; title: string }
): ScoredCandidate {
  return {
    source: 'google_books',
    externalId: 'gb-1',
    authors: ['Test Author'],
    isbn10: null,
    isbn13: null,
    publisher: null,
    publishedYear: null,
    coverUrl: null,
    ...overrides,
  };
}

describe('dedupeCandidates', () => {
  it('deduplicates by isbn_13: keeps higher score', () => {
    const a = makeCandidate({ title: 'Solaris', isbn13: '9780156027601', matchScore: 0.9 });
    const b = makeCandidate({
      title: 'Solaris (EN)',
      source: 'open_library',
      isbn13: '9780156027601',
      matchScore: 0.7,
    });

    const result = dedupeCandidates([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].matchScore).toBe(0.9);
    expect(result[0].source).toBe('google_books');
  });

  it('deduplicates by isbn_13: prefers google_books on tie', () => {
    const google = makeCandidate({ title: 'Solaris', isbn13: '9780156027601', matchScore: 0.8 });
    const ol = makeCandidate({
      title: 'Solaris',
      source: 'open_library',
      isbn13: '9780156027601',
      matchScore: 0.8,
    });

    const result = dedupeCandidates([ol, google]);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('google_books');
  });

  it('deduplicates no-ISBN candidates by fuzzy title (dist < 3)', () => {
    const a = makeCandidate({ title: 'Solaris', matchScore: 0.9 });
    const b = makeCandidate({ title: 'Solari', matchScore: 0.7 }); // dist=1 < 3 → dupe

    const result = dedupeCandidates([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Solaris');
  });

  it('keeps no-ISBN candidates with distant titles', () => {
    const a = makeCandidate({ title: 'Solaris', matchScore: 0.9 });
    const b = makeCandidate({ title: 'Dune', matchScore: 0.7 }); // dist far > 3 → separate

    const result = dedupeCandidates([a, b]);
    expect(result).toHaveLength(2);
  });

  it('returns sorted by matchScore descending', () => {
    const low = makeCandidate({ title: 'Dune', matchScore: 0.5 });
    const high = makeCandidate({ title: 'Solaris', matchScore: 0.9 });
    const mid = makeCandidate({ title: 'Foundation', isbn13: '9780553293357', matchScore: 0.75 });

    const result = dedupeCandidates([low, high, mid]);
    expect(result[0].matchScore).toBeGreaterThanOrEqual(result[1].matchScore);
    expect(result[1].matchScore).toBeGreaterThanOrEqual(result[2].matchScore);
  });

  it('handles empty input', () => {
    expect(dedupeCandidates([])).toEqual([]);
  });
});

describe('checkCatalogDuplicate', () => {
  const existingBooks = [
    { id: 'b1', title: 'Solaris', authors: ['Stanisław Lem'], isbn_13: '9780156027601', isbn_10: null },
    { id: 'b2', title: 'Dune', authors: ['Frank Herbert'], isbn_13: '9780441013593', isbn_10: null },
  ];

  it('returns exact when isbn_13 matches catalog', () => {
    const candidate = makeCandidate({ title: 'Solaris', isbn13: '9780156027601', matchScore: 0.9 });
    const result = checkCatalogDuplicate(candidate, existingBooks);
    expect(result?.type).toBe('exact');
  });

  it('returns null when isbn_13 not in catalog', () => {
    const candidate = makeCandidate({ title: 'Foundation', isbn13: '9780553293357', matchScore: 0.8 });
    const result = checkCatalogDuplicate(candidate, existingBooks);
    expect(result).toBeNull();
  });

  it('returns edition for fuzzy title+author match with different ISBN', () => {
    const candidate = makeCandidate({
      title: 'Solaris',
      authors: ['Stanisław Lem'],
      isbn13: '9781234567890', // different ISBN
      matchScore: 0.8,
    });
    const result = checkCatalogDuplicate(candidate, existingBooks);
    expect(result?.type).toBe('edition');
  });

  it('returns null for similar title but no author overlap', () => {
    const candidate = makeCandidate({
      title: 'Solaris',
      authors: ['Someone Else'],
      isbn13: '9781234567890',
      matchScore: 0.7,
    });
    const result = checkCatalogDuplicate(candidate, existingBooks);
    expect(result).toBeNull();
  });

  it('returns null for empty catalog', () => {
    const candidate = makeCandidate({ title: 'Solaris', isbn13: '9780156027601', matchScore: 0.9 });
    expect(checkCatalogDuplicate(candidate, [])).toBeNull();
  });
});
