import { describe, it, expect } from 'vitest';
import {
  deCyrillic,
  cleanSearchTitle,
  mainTitleSegment,
  titleQueryVariants,
  extractAuthorFromTitle,
  extractSignificantWords,
  WORD_FALLBACK_MIN_LEN,
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

  it('stripuje ucięte OCR słowo ŻYC... na końcu', () => {
    expect(cleanSearchTitle('WIELKI OGARNACZ ŻYC...')).toBe('WIELKI OGARNACZ');
  });

  it('stripuje trailing "..." bez poprzedzającego słowa-fragmentu', () => {
    expect(cleanSearchTitle('Wielki Ogarnacz...')).toBe('Wielki Ogarnacz');
  });

  it('stripuje poziomy wielokropek (…)', () => {
    expect(cleanSearchTitle('Wielki Ogarnacz…')).toBe('Wielki Ogarnacz');
  });

  it('zostawia długie pełne słowo przed "..." — strip tylko kropek', () => {
    expect(cleanSearchTitle('WIELKI OGARNACZ OGARNIACZ...')).toBe('WIELKI OGARNACZ OGARNIACZ');
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

// --- Testy graniczne dopisane po pierwszym runie mutation testing (Stryker,
// P3 planu certyfikacyjnego): zabijają mutanty mapy homoglifów, kwantyfikatorów
// regex i granic długości, które przeżyły run bazowy (score 56%).

describe('deCyrillic — pełna mapa homoglifów', () => {
  it('mapuje każdy znak z mapy małych liter', () => {
    expect(deCyrillic('аеосрхукмтнвіј')).toBe('aeocpxykmthbij');
  });

  it('mapuje każdy znak z mapy wielkich liter', () => {
    expect(deCyrillic('АЕОСРХУКМТНВІ')).toBe('AEOCPXYKMTHBI');
  });

  it('cyrylicki znak spoza mapy zostaje nietknięty', () => {
    // ж nie ma łacińskiego odpowiednika kształtu — fallback `?? ch`
    expect(deCyrillic('жук')).toBe('жyk');
  });
});

describe('cleanSearchTitle — granice regexów', () => {
  it('fragment 6+ znaków przed "..." NIE jest stripowany (granica {1,5})', () => {
    expect(cleanSearchTitle('TYTUŁ ABCDEF...')).toBe('TYTUŁ ABCDEF');
  });

  it('dwie kropki na końcu nie są wielokropkiem ({3,})', () => {
    expect(cleanSearchTitle('Inicjały B.B..')).toBe('Inicjały B.B..');
  });

  it('zakres lat w środku tytułu też znika (global flag)', () => {
    expect(cleanSearchTitle('Dzienniki 1939-1945 tom drugi')).toBe('Dzienniki tom drugi');
  });

  it('em-dash w zakresie lat też łapany', () => {
    expect(cleanSearchTitle('Listy 1900—1910')).toBe('Listy');
  });

  it('liczby inne niż 4-cyfrowe nie są zakresem lat', () => {
    expect(cleanSearchTitle('Pokój 101-102')).toBe('Pokój 101-102');
  });
});

describe('mainTitleSegment — granice', () => {
  it('zwraca wejście gdy wszystkie człony krótsze niż 3 znaki', () => {
    expect(mainTitleSegment('Y: ab')).toBe('Y: ab');
  });

  it('przy równej długości członów wygrywa pierwszy (stabilny reduce)', () => {
    expect(mainTitleSegment('ABC: XYZ')).toBe('ABC');
  });

  it('człon dokładnie 3-znakowy przechodzi filtr (granica >= 3)', () => {
    expect(mainTitleSegment('Y: Lód')).toBe('Lód');
  });
});

describe('extractAuthorFromTitle — granice wzorca', () => {
  it('tytuł 1-znakowy przed myślnikiem nie matchuje (granica {3,} z dosuniętą spacją)', () => {
    // 'A ' przed myślnikiem to 2 znaki — poniżej kwantyfikatora {3,}.
    // Uwaga: 'Ab — X Y' już matchuje, bo `.` w grupie liczy też spację ('Ab ' = 3).
    const r = extractAuthorFromTitle('A — Etgar Keret');
    expect(r.title).toBe('A — Etgar Keret');
    expect(r.author).toBeNull();
  });

  it('4 słowa po myślniku to nie nazwisko (granica <= 3)', () => {
    const r = extractAuthorFromTitle('Tytuł — Jan Maria Konstanty Nowak');
    expect(r.author).toBeNull();
  });

  it('słowo z małej litery po myślniku odpada', () => {
    const r = extractAuthorFromTitle('Tytuł — mały Keret');
    expect(r.author).toBeNull();
  });

  it('zwykły dywiz (-) nie jest separatorem autora', () => {
    const r = extractAuthorFromTitle('Niebo - Etgar Keret');
    expect(r.author).toBeNull();
  });

  it('polskie diakrytyki na początku słów autora akceptowane', () => {
    const r = extractAuthorFromTitle('Wiersze — Łukasz Żebrowski');
    expect(r.author).toBe('Łukasz Żebrowski');
    expect(r.title).toBe('Wiersze');
  });
});

describe('titleQueryVariants — granice', () => {
  it('pusty string daje pustą listę wariantów (filtr length > 0)', () => {
    expect(titleQueryVariants('')).toEqual([]);
    expect(titleQueryVariants('   ')).toEqual([]);
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

describe('extractSignificantWords', () => {
  it('stała WORD_FALLBACK_MIN_LEN wynosi 5', () => {
    expect(WORD_FALLBACK_MIN_LEN).toBe(5);
  });

  it('happy path — "Słowcy Koszmarów" → najdłuższe pierwsze', () => {
    const result = extractSignificantWords('Słowcy Koszmarów');
    expect(result).toEqual(['Koszmarów', 'Słowcy']);
  });

  it('pusty string → pusta lista', () => {
    expect(extractSignificantWords('')).toEqual([]);
  });

  it('wszystkie słowa < 5 znaków → pusta lista', () => {
    expect(extractSignificantWords('Lem Lub')).toEqual([]);
  });

  it('duplikaty są deduplikowane', () => {
    const result = extractSignificantWords('Siewcy Siewcy Koszmarów');
    expect(result).toEqual(['Koszmarów', 'Siewcy']);
  });

  it('cyrylickie homoglify oczyszczone przez cleanSearchTitle przed tokenizacją', () => {
    // 'Asprа' — końcowe 'а' to U+430 (cyrylica) → cleanSearchTitle mapuje na 'a'
    const result = extractSignificantWords('Asprа');
    expect(result).toEqual(['Aspra']);
  });

  it('słowa dokładnie 5 znaków przechodzą próg (granica >= 5)', () => {
    expect(extractSignificantWords('Abcde')).toEqual(['Abcde']);
  });

  it('słowa 4 znaki odpadają (granica >= 5)', () => {
    expect(extractSignificantWords('Abcd')).toEqual([]);
  });

  it('sortuje od najdłuższego — wiele słów rożnej długości', () => {
    const result = extractSignificantWords('Krótkość Dlugociagniete Srednia');
    expect(result[0]).toBe('Dlugociagniete');
    expect(result[1]).toBe('Krótkość');
    expect(result[2]).toBe('Srednia');
  });
});
