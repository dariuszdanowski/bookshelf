import { describe, expect, it } from 'vitest';

import { AiResolutionResultSchema } from '../../../../src/lib/resolution/schema';

describe('AiResolutionResultSchema', () => {
  it('akceptuje poprawny wynik found', () => {
    const result = AiResolutionResultSchema.safeParse({
      status: 'found',
      title: 'Złodzieje książek',
      authors: ['Markus Zusak'],
      isbn10: null,
      isbn13: '9788375080195',
      publisher: 'Wydawnictwo Znak',
      publishedYear: 2006,
      confidence: 0.92,
    });
    expect(result.success).toBe(true);
  });

  it('akceptuje found bez podanych authors (default [])', () => {
    const result = AiResolutionResultSchema.safeParse({
      status: 'found',
      title: 'Solaris',
      isbn10: null,
      isbn13: null,
      publisher: null,
      publishedYear: null,
      confidence: 0.8,
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.status === 'found') {
      expect(result.data.authors).toEqual([]);
    }
  });

  it('akceptuje poprawny wynik not_found', () => {
    const result = AiResolutionResultSchema.safeParse({
      status: 'not_found',
      reason: 'Brak jednoznacznego trafienia',
    });
    expect(result.success).toBe(true);
  });

  it('akceptuje not_found z reason=null', () => {
    const result = AiResolutionResultSchema.safeParse({ status: 'not_found', reason: null });
    expect(result.success).toBe(true);
  });

  it('odrzuca found bez tytułu', () => {
    const result = AiResolutionResultSchema.safeParse({
      status: 'found',
      authors: [],
      isbn10: null,
      isbn13: null,
      publisher: null,
      publishedYear: null,
      confidence: 0.9,
    });
    expect(result.success).toBe(false);
  });

  it('odrzuca confidence poza zakresem [0,1]', () => {
    const tooHigh = AiResolutionResultSchema.safeParse({
      status: 'found',
      title: 'Solaris',
      authors: [],
      isbn10: null,
      isbn13: null,
      publisher: null,
      publishedYear: null,
      confidence: 1.5,
    });
    const negative = AiResolutionResultSchema.safeParse({
      status: 'found',
      title: 'Solaris',
      authors: [],
      isbn10: null,
      isbn13: null,
      publisher: null,
      publishedYear: null,
      confidence: -0.1,
    });
    expect(tooHigh.success).toBe(false);
    expect(negative.success).toBe(false);
  });

  it('odrzuca nieznany status', () => {
    const result = AiResolutionResultSchema.safeParse({ status: 'maybe', title: 'Solaris' });
    expect(result.success).toBe(false);
  });

  it('odrzuca malformed payload (brak status)', () => {
    const result = AiResolutionResultSchema.safeParse({ title: 'Solaris', confidence: 0.9 });
    expect(result.success).toBe(false);
  });
});
