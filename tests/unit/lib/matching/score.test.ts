import { describe, expect, it } from 'vitest';
import { scoreCandidate, authorTokensMatch, MATCH_HIGH, MATCH_MID } from '../../../../src/lib/matching/score';

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

  it('anthology penalty: 1 trafiony autor z 12 (antologia) NIE daje pełnego authorSim', () => {
    // Realny przypadek: detekcja "Alter Ego" / Milena Wójtowicz dopasowana do
    // antologii "Inne nieba" (12 autorów, w tym Wójtowicz). Bez kary score=0.48
    // wypychał fałszywą propozycję. Z karą authorSim ×(3/12) → score znacząco niżej.
    const anthologyAuthors = [
      'Ewa Białołęcka', 'Krystyna Chodorowska', 'Agnieszka Hałas', 'Anna Hrycyszyn',
      'Aneta Jadowska', 'Aleksandra Janusz', 'Anna Kańtoch', 'Magdalena Kubasiewicz',
      'Anna Nieznaj', 'Martyna Raduchowska', 'Milena Wójtowicz', 'Aleksandra Zielińska',
    ];
    const score = scoreCandidate(
      { raw_title: 'Alter Ego', raw_author: 'Milena Wójtowicz' },
      { title: 'Inne nieba', authors: anthologyAuthors, isbn13: '9788383303857', isbn10: null }
    );
    // titleSim≈0.20, authorSim = 1.0 × (3/12) = 0.25 → 0.65*0.20 + 0.30*0.25 + 0.05 ≈ 0.255
    expect(score).toBeLessThan(MATCH_MID); // poniżej progu → "brak matchu"
  });

  it('anthology penalty: współautorstwo (≤3 autorów) bez kary', () => {
    const score = scoreCandidate(
      { raw_title: 'Dobry Omen', raw_author: 'Terry Pratchett' },
      { title: 'Dobry Omen', authors: ['Terry Pratchett', 'Neil Gaiman'], isbn13: null, isbn10: null }
    );
    // tytuł exact (0.65) + autor exact bez kary (0.30) = 0.95
    expect(score).toBeCloseTo(0.95, 2);
  });

  it('anthology penalty: trafiony autor w dużej antologii nie wystarcza przy złym tytule', () => {
    const many = Array.from({ length: 10 }, (_, i) => `Autor ${i}`);
    many.push('Jan Kowalski');
    const score = scoreCandidate(
      { raw_title: 'Zupełnie Inny Tytuł', raw_author: 'Jan Kowalski' },
      { title: 'Antologia Czegoś', authors: many, isbn13: null, isbn10: null }
    );
    // authorSim = 1.0 × (3/11) ≈ 0.27 → wkład autora ≤ 0.082, niski tytuł → score niski
    expect(score).toBeLessThan(MATCH_MID);
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

describe('authorSim — order-independent (przez scoreCandidate)', () => {
  // Realny case S-33: BN zwraca autora w formacie „Nazwisko, Imię". Whole-string
  // Levenshtein dawał authorSim 0.16 → score 75% mimo idealnego matchu (tytuł+autor
  // +ISBN). Order-independent token-set → authorSim ~1.0 → wysoka pewność.
  it('„Imię Nazwisko" vs „Nazwisko, Imię" (format BN) → wysoki score', () => {
    const score = scoreCandidate(
      { raw_title: 'Przytulajka', raw_author: 'Agnieszka Krawczyk' },
      { title: 'Przytulajka', authors: ['Krawczyk, Agnieszka'], isbn13: '9788379768578', isbn10: null }
    );
    expect(score).toBeGreaterThanOrEqual(MATCH_HIGH); // >= 0.75, realnie ~1.0
  });

  it('OCR złapał samo nazwisko: „Lem" vs „Stanisław Lem" → pełny kredyt autora', () => {
    const partial = scoreCandidate(
      { raw_title: 'Solaris', raw_author: 'Lem' },
      { title: 'Solaris', authors: ['Stanisław Lem'], isbn13: null, isbn10: null }
    );
    const full = scoreCandidate(
      { raw_title: 'Solaris', raw_author: 'Stanisław Lem' },
      { title: 'Solaris', authors: ['Stanisław Lem'], isbn13: null, isbn10: null }
    );
    expect(partial).toBeCloseTo(full, 2); // nazwisko wystarcza
  });

  it('inny autor nadal niski (Agnieszka Krawczyk vs Danuta Bieńkowska)', () => {
    const score = scoreCandidate(
      { raw_title: 'X', raw_author: 'Agnieszka Krawczyk' },
      { title: 'X', authors: ['Danuta Bieńkowska'], isbn13: null, isbn10: null }
    );
    // tytuł exact 0.65, autor ~0 → poniżej MATCH_HIGH (nie windujemy złego autora)
    expect(score).toBeLessThan(MATCH_HIGH);
  });
});

describe('authorTokensMatch', () => {
  it('wyklucza zupełnie innego autora (Agnieszka Lis vs Kazimierz Arendt)', () => {
    // Realny przypadek: rematch „Poczta"/Agnieszka Lis dopasował „Poczta polska"
    // Kazimierza Arendta (authorSim Levenshtein = 0.31, fałszywie > próg 0.30).
    expect(authorTokensMatch('Agnieszka Lis', ['Kazimierz Arendt'])).toBe(false);
  });

  it('akceptuje wspólny token nazwiska (Lem vs Stanisław Lem)', () => {
    expect(authorTokensMatch('Lem', ['Stanisław Lem'])).toBe(true);
  });

  it('akceptuje pełne dopasowanie z odwróconą kolejnością tokenów', () => {
    expect(authorTokensMatch('Agnieszka Lis', ['Lis Agnieszka'])).toBe(true);
  });

  it('toleruje literówkę OCR w obrębie tokenu (Liss ~ Lis)', () => {
    expect(authorTokensMatch('Agnieszka Liss', ['Agnieszka Lis'])).toBe(true);
  });

  it('ignoruje diakrytyki (Józef Hen ~ Jozef Hen)', () => {
    expect(authorTokensMatch('Józef Hen', ['Jozef Hen'])).toBe(true);
  });

  it('nie wyklucza gdy brak wykrytego autora', () => {
    expect(authorTokensMatch(null, ['Kazimierz Arendt'])).toBe(true);
  });

  it('nie wyklucza gdy kandydat nie ma danych autora', () => {
    expect(authorTokensMatch('Agnieszka Lis', [])).toBe(true);
  });

  it('akceptuje gdy choć jeden autor wieloautorskiego kandydata pasuje', () => {
    expect(authorTokensMatch('Gaiman', ['Terry Pratchett', 'Neil Gaiman'])).toBe(true);
  });
});
