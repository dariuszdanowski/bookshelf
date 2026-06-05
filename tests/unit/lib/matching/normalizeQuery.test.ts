import { describe, it, expect } from 'vitest';
import {
  deCyrillic,
  cleanSearchTitle,
  mainTitleSegment,
  titleQueryVariants,
  extractAuthorFromTitle,
} from '../../../../src/lib/matching/normalizeQuery';

describe('deCyrillic', () => {
  it('mapuje cyrylickie homoglify na łacinę (realne przypadki OCR)', () => {
    // "Filutек" — е=U+435, к=U+43A (cyrylica); "Asprа" — а=U+430
    expect(deCyrillic('Filutек')).toBe('Filutek');
    expect(deCyrillic('Asprа')).toBe('Aspra');
  });

  it('zostawia łacinę i polskie diakrytyki nietknięte', () => {
    expect(deCyrillic('Popioły dzieciństwa')).toBe('Popioły dzieciństwa');
  });
});

describe('cleanSearchTitle', () => {
  it('usuwa zakres lat', () => {
    expect(cleanSearchTitle('Prof. Filutek 1985-2003')).toBe('Prof. Filutek');
    expect(cleanSearchTitle('Coś 1967–1984')).toBe('Coś'); // myślnik en-dash
  });

  it('de-cyrylizuje + tnie lata łącznie', () => {
    expect(cleanSearchTitle('Prof. Filutек 1985-2003')).toBe('Prof. Filutek');
  });

  it('kolapsuje białe znaki', () => {
    expect(cleanSearchTitle('A   B    C')).toBe('A B C');
  });
});

describe('mainTitleSegment', () => {
  it('bierze najdłuższy człon przy podtytule po –/:', () => {
    expect(mainTitleSegment('Y: OSTATNI Z MĘŻCZYZN – ZARAZA')).toBe('OSTATNI Z MĘŻCZYZN');
  });

  it('zwraca całość gdy brak separatora', () => {
    expect(mainTitleSegment('Popioły dzieciństwa')).toBe('Popioły dzieciństwa');
  });

  it('ignoruje człony krótsze niż 3 znaki', () => {
    expect(mainTitleSegment('Y: Coś Dłuższego')).toBe('Coś Dłuższego');
  });
});

describe('extractAuthorFromTitle', () => {
  it('rozdziela "Tytuł — Imię Nazwisko"', () => {
    const r = extractAuthorFromTitle('Usterka na skraju — Etgar Keret');
    expect(r.title).toBe('Usterka na skraju');
    expect(r.author).toBe('Etgar Keret');
  });

  it('obsługuje trójczłonowe nazwisko', () => {
    const r = extractAuthorFromTitle('Sto lat samotności — Gabriel García Márquez');
    expect(r.title).toBe('Sto lat samotności');
    expect(r.author).toBe('Gabriel García Márquez');
  });

  it('nie ekstrahuje ALL-CAPS podtytułu jako autora', () => {
    const r = extractAuthorFromTitle('Y: OSTATNI Z MĘŻCZYZN — ZARAZA');
    expect(r.author).toBeNull();
  });

  it('nie ekstrahuje pojedynczego słowa jako autora', () => {
    const r = extractAuthorFromTitle('Solaris — Lem');
    expect(r.author).toBeNull();
  });

  it('zwraca oryginalny tytuł gdy wzorzec nie pasuje', () => {
    const r = extractAuthorFromTitle('Solaris');
    expect(r.title).toBe('Solaris');
    expect(r.author).toBeNull();
  });
});

describe('titleQueryVariants', () => {
  it('zwraca [pełny oczyszczony, główny człon] bez duplikatów', () => {
    const v = titleQueryVariants('Y: OSTATNI Z MĘŻCZYZN – ZARAZA');
    expect(v[0]).toBe('Y: OSTATNI Z MĘŻCZYZN – ZARAZA');
    expect(v[1]).toBe('OSTATNI Z MĘŻCZYZN');
    expect(v).toHaveLength(2);
  });

  it('deduplikuje gdy nie ma podtytułu', () => {
    const v = titleQueryVariants('Divinity');
    expect(v).toEqual(['Divinity']);
  });

  it('oczyszczony tytuł trafia jako pierwszy wariant (homoglify+lata)', () => {
    const v = titleQueryVariants('Prof. Filutек 1985-2003');
    expect(v[0]).toBe('Prof. Filutek');
  });
});
