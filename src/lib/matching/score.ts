export const MATCH_HIGH = 0.75;
export const MATCH_MID = 0.55;

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = new Array<number>(n + 1);
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] =
        a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    prev = curr;
  }
  return prev[n];
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function titleSim(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return Math.max(0, 1 - levenshtein(na, nb) / maxLen);
}

// Powyżej tylu autorów kandydat jest traktowany jak antologia: dopasowanie
// jednego wykrytego nazwiska do listy 12 autorów to słaby sygnał, że książka
// jest "tego" autora — pełen kredyt 1.0 zatruwał score (np. tytuł 0.20 +
// autor 1.0 → 0.48, fałszywa propozycja). Współautorstwo (≤3) bez kary.
const ANTHOLOGY_AUTHOR_THRESHOLD = 3;

// Tłumi pewność dopasowania autora dla kandydatów wieloautorskich.
// 1.0 dla ≤3 autorów; potem ANTHOLOGY_AUTHOR_THRESHOLD / N (ciągłe w N=3).
function multiAuthorConfidence(authorCount: number): number {
  if (authorCount <= ANTHOLOGY_AUTHOR_THRESHOLD) return 1;
  return ANTHOLOGY_AUTHOR_THRESHOLD / authorCount;
}

/** Tokeny nazwiska/imienia (≥2 znaki po normalizacji). */
function nameTokens(s: string): string[] {
  return normalize(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

/**
 * Order-independent podobieństwo zbiorów tokenów: średnia z najlepszych dopasowań
 * tokenów wykrytego autora do dowolnego tokenu kandydata. „Agnieszka Krawczyk" vs
 * „Krawczyk, Agnieszka" (format BN „Nazwisko, Imię") → 1.0; „Lem" ⊆ „Stanisław Lem"
 * → 1.0 (OCR złapał samo nazwisko). Levenshtein per token toleruje literówkę.
 */
function tokenSetSim(detTokens: string[], candTokens: string[]): number {
  if (detTokens.length === 0 || candTokens.length === 0) return 0;
  let sum = 0;
  for (const dt of detTokens) {
    let best = 0;
    for (const ct of candTokens) {
      const maxLen = Math.max(dt.length, ct.length);
      const s = maxLen === 0 ? 1 : Math.max(0, 1 - levenshtein(dt, ct) / maxLen);
      if (s > best) best = s;
    }
    sum += best;
  }
  return sum / detTokens.length;
}

export function authorSim(
  detectionAuthor: string | null | undefined,
  candidateAuthors: string[],
): number {
  if (!detectionAuthor) return 0.5; // neutral — no OCR author info
  if (candidateAuthors.length === 0) return 0.5; // neutral — candidate has no author data
  const detTokens = nameTokens(detectionAuthor);
  if (detTokens.length === 0) return 0.5; // tylko bardzo krótkie tokeny — brak sygnału
  // Order-independent (nie whole-string Levenshtein) — inaczej „Imię Nazwisko" vs
  // „Nazwisko, Imię" (format BN) fałszywie zaniża score mimo identycznego autora.
  const best = Math.max(...candidateAuthors.map((a) => tokenSetSim(detTokens, nameTokens(a))));
  return best * multiAuthorConfidence(candidateAuthors.length);
}

// Tokeny nazwiska/imienia (≥3 znaki po normalizacji) — wyklucza inicjały i szum
// typu „de", „van". Diakrytyki zdjęte przez normalize.
function authorTokens(s: string): string[] {
  return normalize(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

/**
 * Czy autor kandydata to PLAUSYBILNIE ta sama osoba co wykryty autor — sygnał
 * tokenowy (po nazwisku/imieniu), NIE Levenshtein na całym ciągu. Dwa różne
 * nazwiska o podobnej długości („Agnieszka Lis" vs „Kazimierz Arendt") dają
 * przez Levenshtein ~0.31 z samego nakładania liter — fałszywie przechodziły
 * próg filtra. Token-overlap jest właściwym dyskryminatorem dla nazwisk.
 *
 * Gdy detekcja ma 2+ tokenów (imię + nazwisko), filtrujemy po OSTATNIM tokenie
 * (nazwisku w polskiej konwencji „Imię Nazwisko"). Samo imię to zbyt słaby sygnał —
 * „Magdalena Jedysek" vs „Magdalena Banaszkiewicz" fałszywie przechodziło przez
 * any-token match na wspólnym „Magdalena". Próg 0.75 (zamiast 0.8) toleruje
 * 1-literówkę w krótkim nazwisku (3–4 znaki, np. „Liss" ~ „Lis").
 *
 * Zwraca true (nie wykluczaj) gdy: brak wykrytego autora, brak danych autora
 * u kandydata, albo wykryty autor ma tylko bardzo krótkie tokeny (nie da się
 * rozróżnić). Wyklucza tylko gdy kandydat MA autora i token nazwiska się nie zgadza.
 */
export function authorTokensMatch(
  detectionAuthor: string | null | undefined,
  candidateAuthors: string[],
): boolean {
  if (!detectionAuthor) return true;
  const dTokens = authorTokens(detectionAuthor);
  if (dTokens.length === 0) return true; // tylko krótkie tokeny — brak sygnału
  const cTokens = candidateAuthors.flatMap(authorTokens);
  if (cTokens.length === 0) return true; // kandydat bez autora — nie wykluczaj

  // Gdy mamy imię + nazwisko, używamy OSTATNIEGO tokenu (nazwisko) jako klucza.
  // Imię samo w sobie to za słaby sygnał — wiele autorek nosi to samo imię.
  if (dTokens.length >= 2) {
    const keyToken = dTokens[dTokens.length - 1];
    return cTokens.some((ct) => {
      if (keyToken === ct) return true;
      const maxLen = Math.max(keyToken.length, ct.length);
      return 1 - levenshtein(keyToken, ct) / maxLen >= 0.75;
    });
  }

  return dTokens.some((dt) =>
    cTokens.some((ct) => {
      if (dt === ct) return true;
      const maxLen = Math.max(dt.length, ct.length);
      return 1 - levenshtein(dt, ct) / maxLen >= 0.8; // tolerancja literówki OCR per token
    }),
  );
}

type Detection = { raw_title: string; raw_author: string | null };
type Candidate = { title: string; authors: string[]; isbn13: string | null; isbn10: string | null };

export function scoreCandidate(detection: Detection, candidate: Candidate): number {
  const isbnBonus = candidate.isbn13 || candidate.isbn10 ? 0.05 : 0;
  return Math.min(
    1,
    0.65 * titleSim(detection.raw_title, candidate.title) +
      0.3 * authorSim(detection.raw_author, candidate.authors) +
      isbnBonus,
  );
}
