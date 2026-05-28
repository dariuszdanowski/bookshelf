import { describe, expect, it } from 'vitest';
import {
  normalizeIsbn,
  validateIsbn10,
  validateIsbn13,
  isbn10to13,
  isbn13to10,
} from '../../../../src/lib/matching/isbn';

describe('normalizeIsbn', () => {
  it('strips hyphens and spaces', () => {
    expect(normalizeIsbn('978-0-06-112008-4')).toBe('9780061120084');
    expect(normalizeIsbn('0 14 028329 X')).toBe('014028329X');
  });

  it('returns unchanged string with no separators', () => {
    expect(normalizeIsbn('9780061120084')).toBe('9780061120084');
  });
});

describe('validateIsbn10', () => {
  it('validates correct ISBN-10', () => {
    expect(validateIsbn10('0306406152')).toBe(true);
    // 000000006X: prefix 000000006 → sum=12, check=(11-1)%11=10=X ✓
    expect(validateIsbn10('000000006X')).toBe(true);
  });

  it('rejects invalid checksum', () => {
    expect(validateIsbn10('0306406153')).toBe(false);
  });

  it('rejects wrong length', () => {
    expect(validateIsbn10('030640615')).toBe(false);
    expect(validateIsbn10('03064061520')).toBe(false);
  });

  it('rejects non-digit chars except X at end', () => {
    expect(validateIsbn10('030640615X')).toBe(false); // wrong checksum
    expect(validateIsbn10('X306406152')).toBe(false); // X not at end
  });
});

describe('validateIsbn13', () => {
  it('validates correct ISBN-13', () => {
    expect(validateIsbn13('9780306406157')).toBe(true);
    expect(validateIsbn13('978-0-306-40615-7')).toBe(true);
    expect(validateIsbn13('9791032302217')).toBe(true); // 979 prefix
  });

  it('rejects invalid checksum', () => {
    expect(validateIsbn13('9780306406158')).toBe(false);
  });

  it('rejects wrong length', () => {
    expect(validateIsbn13('978030640615')).toBe(false);
    expect(validateIsbn13('97803064061570')).toBe(false);
  });

  it('rejects non-numeric', () => {
    expect(validateIsbn13('978030640615X')).toBe(false);
  });
});

describe('isbn10to13', () => {
  it('converts valid ISBN-10 to ISBN-13', () => {
    expect(isbn10to13('0306406152')).toBe('9780306406157');
  });

  it('returns null for invalid ISBN-10', () => {
    expect(isbn10to13('0306406153')).toBeNull();
  });

  it('handles X check digit', () => {
    const result = isbn10to13('000000006X');
    expect(result).not.toBeNull();
    if (result) expect(validateIsbn13(result)).toBe(true);
  });
});

describe('isbn13to10', () => {
  it('converts valid 978-prefixed ISBN-13 to ISBN-10', () => {
    expect(isbn13to10('9780306406157')).toBe('0306406152');
  });

  it('returns null for 979-prefixed ISBN-13', () => {
    expect(isbn13to10('9791032302217')).toBeNull();
  });

  it('returns null for invalid ISBN-13', () => {
    expect(isbn13to10('9780306406158')).toBeNull();
  });

  it('round-trips: isbn10 → isbn13 → isbn10', () => {
    const original = '0306406152';
    const isbn13 = isbn10to13(original);
    expect(isbn13).not.toBeNull();
    if (isbn13) expect(isbn13to10(isbn13)).toBe(original);
  });
});
