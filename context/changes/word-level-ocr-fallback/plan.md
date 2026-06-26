# S-48 Word-level OCR Fallback — Plan implementacji

## Przegląd

Gdy OCR garbles pierwszy wyraz tytułu (np. "Słowcy" zamiast "Siewcy"), istniejąca kaskada
`searchGoogleBooks` wyczerpuje się i spada na `inauthor:`, który zwraca losowe tytuły z
bibliografii autora (np. "Łowiec" w 27%). Dodajemy jeden blok post-scoring w
`findCandidates.ts`, który wyodrębnia istotne słowa z `rawTitle` i próbuje je osobno jako
token tytułu + rawAuthor, dopóki nie znajdzie kandydata ≥ MATCH_MID (0.55).

## Analiza stanu obecnego

`findCandidates.ts:34–106` — pipeline: parallel GB + OL + BN → score → filter
(`matchScore >= 0.25 && authorTokensMatch`) → dedup → enrich.

`googleBooks.ts:145–200` — kaskada wewnątrz `searchGoogleBooks`: ISBN → intitle+inauthor →
intitle → publisher+intitle → free-text variants → inauthor-only. Ostatni krok `inauthor:`
zwraca całą bibliografię autora gdy żaden wariant tytułowy nie zadziałał — score 0.20–0.30
(wyłącznie author bonus), co przepuszcza próg SEARCH_MIN_SCORE (0.25) ale nie MATCH_MID.

`normalizeQuery.ts` — `cleanSearchTitle`, `titleQueryVariants`, `extractAuthorFromTitle`.
Brak funkcji do tokenizacji słów tytułu.

`score.ts:3–4` — `MATCH_MID = 0.55` i `MATCH_HIGH = 0.75` eksportowane.

Istniejące testy fallbacku: `findCandidatesIsbn.test.ts` (wzorzec mock + import pattern).

## Pożądany stan końcowy

Gdy all scored candidates mają `matchScore < MATCH_MID` i rawAuthor jest dostępny,
`findBookCandidates` próbuje do 3 słów z rawTitle (≥5 znaków, najdłuższe pierwsze) jako
`searchGoogleBooks({ title: word, author: rawAuthor })`. Pierwsze słowo które zwróci
kandydata ≥ MATCH_MID zatrzymuje pętlę. Wyniki trafiają do scored[], przechodzą przez
istniejący filter + dedup + enrich.

**Weryfikacja**: `"Słowcy Koszmarów"` + `"Marowska Duchowna"` → fallback na `"Koszmarów"` →
`intitle:"Koszmarów"+inauthor:"Marowska Duchowna"` → "Siewcy Koszmarów" score ~0.72
(tytuł 0.60 × 0.65 + autor ~1.0 × 0.30 + isbn bonus 0.05 = 0.74 szacunkowo).

### Kluczowe odkrycia

- `MATCH_MID` eksportowany z `score.ts:4` — zaimportować bezpośrednio, nie powielać stałej.
- `findCandidates.ts` nie importuje jeszcze ani `MATCH_MID` ani `extractSignificantWords` —
  oba dodajemy.
- `scored` array jest mutowalny po `sort()` — push + re-sort bez przebudowy struktury.
- `dedupeCandidates` na końcu pipeline obsługuje duplikaty między primary a word-fallback.
- Test pattern z `findCandidatesIsbn.test.ts`: `vi.mock` na 3 źródła + clearAllMocks w
  `beforeEach`.

## Czego NIE robimy

- Fallback bez rawAuthor (zbyt szeroki wynik bez filtra autorskiego)
- OpenLibrary / Biblioteka Narodowa w word-level (GB cascade + scoring wystarcza)
- Zmiana w UI, API, DB
- Modyfikacja kaskady `searchGoogleBooks` (dodajemy krok ponad nią, w `findCandidates`)
- Fallback gdy rawTitle krótkie lub wszystkie słowa < 5 znaków (brak istotnych tokenów)

## Podejście do implementacji

Dwa powiązane kroki:

1. **Helper** `extractSignificantWords(title)` w `normalizeQuery.ts` — czysta funkcja
   tokenizująca, testowana w izolacji.
2. **Blok fallback** w `findCandidates.ts` — wstawiony między `scored.sort(...)` a
   `dedupeCandidates(scored.filter(...))`. Sekwencyjne `await` dla max 3 słów, early-stop
   gdy znajdzie ≥ MATCH_MID. Rate-limited → break (zwróć co mamy).

---

## Faza 1: Pomocnik tokenizacji + testy

### Przegląd

Dodaje `extractSignificantWords` do `normalizeQuery.ts` i pokrywa go testami jednostkowymi.
Czysty, izolowany krok — zero zależności od reszty pipeline.

### Wymagane zmiany

#### 1. Funkcja `extractSignificantWords`

**Plik**: `src/lib/matching/normalizeQuery.ts`

**Cel**: Wyodrębnić ze rawTitle słowa istotne dla word-level fallback — te dość długie, by
być unikalne, posortowane od najdłuższego (najdystynktywniejszego).

**Kontrakt**:
```typescript
export const WORD_FALLBACK_MIN_LEN = 5;

/**
 * Extracts significant title words (>= WORD_FALLBACK_MIN_LEN chars) from rawTitle,
 * deduped and sorted by length descending (longest = most distinctive).
 * Used by word-level OCR fallback in findCandidates when primary search scores low.
 */
export function extractSignificantWords(title: string): string[] {
  const cleaned = cleanSearchTitle(title);
  const words = cleaned.split(/\s+/).filter((w) => w.length >= WORD_FALLBACK_MIN_LEN);
  return [...new Set(words)].sort((a, b) => b.length - a.length);
}
```

#### 2. Testy `extractSignificantWords`

**Plik**: `tests/unit/lib/matching/normalizeQuery.test.ts`

**Cel**: Pokryć happy path i granice (puste wejście, duplikaty, tytuły z cyrylicą/latami).

**Kontrakt**: Dopisać blok `describe('extractSignificantWords', ...)` na końcu pliku.
Przypadki: "Słowcy Koszmarów" → ["Koszmarów", "Słowcy"] (len 9 > 6); pusty string → [];
wszystkie słowa < 5 → []; duplikaty → deduplikowane; cyrylica oczyszczona przez
`cleanSearchTitle` przed tokenizacją.

### Kryteria sukcesu

#### Weryfikacja automatyczna

- Typecheck: `npm run typecheck`
- Testy jednostkowe: `npx vitest run tests/unit/lib/matching/normalizeQuery.test.ts`
- Lint: `npm run lint`

#### Weryfikacja ręczna

- Brak — faza czysto testowalna automatycznie.

---

## Faza 2: Blok word-level fallback + testy integracyjne

### Przegląd

Wstawia blok fallback w `findCandidates.ts` między score a filter. Dodaje plik testów
mockujący `searchGoogleBooks` by weryfikować scenariusze fallbacku bez realnych API calls.

### Wymagane zmiany

#### 1. Blok fallback w `findCandidates.ts`

**Plik**: `src/lib/matching/findCandidates.ts`

**Cel**: Po `scored.sort(...)` a przed `dedupeCandidates(scored.filter(...))`:
gdy `scored[0]?.matchScore ?? 0 < MATCH_MID` i `rawAuthor` dostępny → próbuj kolejne
słowa tytułu jako osobne zapytania GB. Merge wyniki do `scored`, re-sort, early stop gdy
≥ MATCH_MID. Rate-limit → break.

**Kontrakt**: Dodać import `{ MATCH_MID }` z `./score` i `{ extractSignificantWords }` z
`./normalizeQuery`. Nowy blok (max ~20 linii) wstawić między `scored.sort(...)` a
`dedupeCandidates(...)`. Stała lokalna `WORD_FALLBACK_MAX = 3`.

```typescript
// Word-level OCR fallback: when all primary candidates score below MATCH_MID,
// try individual title tokens (longest first) + rawAuthor to recover garbled first word.
const WORD_FALLBACK_MAX = 3;
if ((scored[0]?.matchScore ?? 0) < MATCH_MID && rawAuthor && rawTitle) {
  const words = extractSignificantWords(rawTitle).slice(0, WORD_FALLBACK_MAX);
  for (const word of words) {
    const wordResult = await searchGoogleBooks({ title: word, author: rawAuthor });
    if (!wordResult.ok) {
      if (wordResult.reason === 'rate_limited') break;
      continue;
    }
    const wordScored: ScoredCandidate[] = wordResult.candidates.map((c) => ({
      ...c,
      matchScore: scoreCandidate(
        { raw_title: rawTitle, raw_author: rawAuthor },
        { title: c.title, authors: c.authors, isbn13: c.isbn13, isbn10: c.isbn10 },
      ),
    }));
    scored.push(...wordScored);
    scored.sort((a, b) => b.matchScore - a.matchScore);
    if (wordScored.some((c) => c.matchScore >= MATCH_MID)) break;
  }
}
```

#### 2. Nowy plik testów word-level fallback

**Plik**: `tests/unit/lib/matching/findCandidatesWordFallback.test.ts`

**Cel**: Pokryć 6 scenariuszy fallbacku mockując `searchGoogleBooks`.

**Kontrakt**: Wzorzec identyczny z `findCandidatesIsbn.test.ts`: `vi.mock` na 3 źródła +
`beforeEach` clearAllMocks + domyślne `{ ok: false, reason: 'empty' }`.

Przypadki do pokrycia:
1. Garbled tytuł + dobry autor → fallback wywołany → word token zwraca dobrego kandydata ≥ MATCH_MID
2. Dobry primary match ≥ MATCH_MID → fallback NIE wywołany (mock nie wywołany po primarycall)
3. rawAuthor null → fallback pominięty
4. Wszystkie słowa < 5 znaków → brak słów do próby → fallback pominięty
5. GB rate-limited w fallback → break, zwróć co mamy (rateLimited NIE propaguje do caller)
6. Pierwsze słowo zwraca ≥ MATCH_MID → early stop, drugie słowo nie wywołane

### Kryteria sukcesu

#### Weryfikacja automatyczna

- Testy jednostkowe (oba pliki): `npx vitest run tests/unit/lib/matching/`
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Full test suite: `npx vitest run`

#### Weryfikacja ręczna

- Brak — faza czysto testowalna automatycznie.
  Weryfikacja production: user testuje ręcznie zdjęciem ze "Słowcy Koszmarów"
  na własnym koncie po merge (świadome odłożenie).

---

## Strategia testowania

### Testy jednostkowe

- `normalizeQuery.test.ts` — `extractSignificantWords`: empty, all-short, happy path, dedup,
  cyrylica cleaned before tokenization
- `findCandidatesWordFallback.test.ts` — 6 scenariuszy (j.w.)

### Testy integracyjne / E2E

Brak nowych testów E2E — zmiana czysto back-end (server-side matching); istniejące E2E
mockują `match-stream` na poziomie browser route, nie sprawdzają kandydatów po scoringu.

## Referencje

- `src/lib/matching/findCandidates.ts` — punkt wejścia; linia 74: miejsce wstawienia fallbacku
- `src/lib/matching/normalizeQuery.ts` — dodajemy `extractSignificantWords`
- `src/lib/books/googleBooks.ts:145` — `searchGoogleBooks` reużywana przez fallback
- `src/lib/matching/score.ts:3–4` — `MATCH_MID` import
- `tests/unit/lib/matching/findCandidatesIsbn.test.ts` — wzorzec testów

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dołącz ` — <commit sha>` po zakończeniu.

### Faza 1: Pomocnik tokenizacji

#### Automatyczne

- [x] 1.1 `npm run typecheck` przechodzi
- [x] 1.2 `npx vitest run tests/unit/lib/matching/normalizeQuery.test.ts` — nowe testy zielone
- [x] 1.3 `npm run lint` bez nowych błędów

### Faza 2: Blok fallback + testy

#### Automatyczne

- [x] 2.1 `npx vitest run tests/unit/lib/matching/` — wszystkie testy matching zielone
- [x] 2.2 `npm run typecheck` przechodzi
- [x] 2.3 `npm run lint` bez nowych błędów
- [x] 2.4 `npx vitest run` — pełna suite zielona
