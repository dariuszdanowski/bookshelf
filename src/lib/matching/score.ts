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
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
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

export function authorSim(detectionAuthor: string | null | undefined, candidateAuthors: string[]): number {
  if (!detectionAuthor) return 0.5; // neutral — no OCR author info
  if (candidateAuthors.length === 0) return 0.5; // neutral — candidate has no author data
  const na = normalize(detectionAuthor);
  const sims = candidateAuthors.map((a) => {
    const nb = normalize(a);
    const maxLen = Math.max(na.length, nb.length);
    if (maxLen === 0) return 1;
    return Math.max(0, 1 - levenshtein(na, nb) / maxLen);
  });
  return Math.max(...sims) * multiAuthorConfidence(candidateAuthors.length);
}

type Detection = { raw_title: string; raw_author: string | null };
type Candidate = { title: string; authors: string[]; isbn13: string | null; isbn10: string | null };

export function scoreCandidate(detection: Detection, candidate: Candidate): number {
  const isbnBonus = candidate.isbn13 || candidate.isbn10 ? 0.05 : 0;
  return Math.min(1, 0.65 * titleSim(detection.raw_title, candidate.title) +
    0.30 * authorSim(detection.raw_author, candidate.authors) +
    isbnBonus);
}
