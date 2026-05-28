import { describe, expect, it } from 'vitest';
import { scoreCandidate, MATCH_HIGH, MATCH_MID } from '../../../../src/lib/matching/score';

const exactDetection = { raw_title: 'Solaris', raw_author: 'Stanisław Lem' };
const exactCandidate = {
  title: 'Solaris',
  authors: ['Stanisław Lem'],
  isbn13: '9780156027601',
  isbn10: null,
};

describe('scoreCandidate', () => {
  it('returns ~1.0 for exact title + author + isbn match', () => {
    const score = scoreCandidate(exactDetection, exactCandidate);
    expect(score).toBeCloseTo(1.0, 2);
  });

  it('titleSim: perfect title match contributes 0.65 × 1.0', () => {
    const score = scoreCandidate(
      { raw_title: 'Solaris', raw_author: null },
      { title: 'Solaris', authors: [], isbn13: null, isbn10: null }
    );
    // 0.65 * 1.0 + 0.30 * 0.5 (neutral) + 0 = 0.65 + 0.15 = 0.80
    expect(score).toBeCloseTo(0.80, 2);
  });

  it('titleSim: garbled title gives score < perfect', () => {
    const garbled = scoreCandidate(
      { raw_title: 'PRZECIRZTA ADEPT', raw_author: null },
      { title: 'Solaris', authors: [], isbn13: null, isbn10: null }
    );
    const exact = scoreCandidate(
      { raw_title: 'Solaris', raw_author: null },
      { title: 'Solaris', authors: [], isbn13: null, isbn10: null }
    );
    expect(garbled).toBeLessThan(exact);
  });

  it('authorSim: no detection author → neutral 0.5', () => {
    const score = scoreCandidate(
      { raw_title: 'Solaris', raw_author: null },
      { title: 'Solaris', authors: ['Stanisław Lem'], isbn13: null, isbn10: null }
    );
    // 0.65 * 1.0 + 0.30 * 0.5 + 0 = 0.80
    expect(score).toBeCloseTo(0.80, 2);
  });

  it('authorSim: empty candidate authors → neutral 0.5', () => {
    const score = scoreCandidate(
      { raw_title: 'Solaris', raw_author: 'Lem' },
      { title: 'Solaris', authors: [], isbn13: null, isbn10: null }
    );
    // 0.65 * 1.0 + 0.30 * 0.5 + 0 = 0.80
    expect(score).toBeCloseTo(0.80, 2);
  });

  it('isbnBonus: 0.05 when isbn13 present', () => {
    const withIsbn = scoreCandidate(
      { raw_title: 'Solaris', raw_author: null },
      { title: 'Solaris', authors: [], isbn13: '9780156027601', isbn10: null }
    );
    const noIsbn = scoreCandidate(
      { raw_title: 'Solaris', raw_author: null },
      { title: 'Solaris', authors: [], isbn13: null, isbn10: null }
    );
    expect(withIsbn - noIsbn).toBeCloseTo(0.05, 2);
  });

  it('isbnBonus: 0.05 when isbn10 present (isbn13 null)', () => {
    const withIsbn10 = scoreCandidate(
      { raw_title: 'Solaris', raw_author: null },
      { title: 'Solaris', authors: [], isbn13: null, isbn10: '0156027607' }
    );
    const noIsbn = scoreCandidate(
      { raw_title: 'Solaris', raw_author: null },
      { title: 'Solaris', authors: [], isbn13: null, isbn10: null }
    );
    expect(withIsbn10 - noIsbn).toBeCloseTo(0.05, 2);
  });

  it('score caps at 1.0', () => {
    const score = scoreCandidate(exactDetection, exactCandidate);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it('score is non-negative', () => {
    const score = scoreCandidate(
      { raw_title: 'AAAAAA', raw_author: 'BBBBBB' },
      { title: 'XXXXXX', authors: ['YYYYYY'], isbn13: null, isbn10: null }
    );
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('MATCH_HIGH and MATCH_MID constants have correct values', () => {
    expect(MATCH_HIGH).toBe(0.75);
    expect(MATCH_MID).toBe(0.55);
  });

  it('diacritics normalized: accented chars (ó, ę, ą) stripped before comparison', () => {
    // 'Jozef' vs 'Józef' — ó decomposes under NFD to o + combining acute → stripped
    const withAccent = scoreCandidate(
      { raw_title: 'Opowiadania', raw_author: 'Józef Hen' },
      { title: 'Opowiadania', authors: ['Jozef Hen'], isbn13: null, isbn10: null }
    );
    const withoutAccent = scoreCandidate(
      { raw_title: 'Opowiadania', raw_author: 'Jozef Hen' },
      { title: 'Opowiadania', authors: ['Jozef Hen'], isbn13: null, isbn10: null }
    );
    expect(withAccent).toBeCloseTo(withoutAccent, 2);
  });
});
