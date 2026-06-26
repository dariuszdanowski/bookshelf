# S-48 Word-level OCR Fallback — Krótki plan

> Pełny plan: `context/changes/word-level-ocr-fallback/plan.md`

## Co i dlaczego

Gdy OCR czyta "Słowcy Koszmarów" zamiast "Siewcy Koszmarów", istniejąca kaskada wyszukiwania
GB wyczerpuje wszystkie warianty tytułowe i spada na `inauthor:` — który zwraca losowe książki
z bibliografii autora (np. "Łowiec" w 27%). Dodajemy word-level fallback: zamiast zwracać
losowy wynik, wyodrębniamy istotne słowa z rawTitle i próbujemy każde osobno + autor
(`intitle:"Koszmarów"+inauthor:"Marowska Duchowna"`) — co trafi "Siewcy Koszmarów".

## Punkt wyjścia

`findCandidates.ts` pipeline: parallel search → score → filter (≥ 0.25 && authorTokensMatch)
→ dedup → enrich. Fallback dodajemy jako blok między `scored.sort()` a `dedupeCandidates()` —
zero zmian w API/DB/UI, zero nowych endpointów.

## Pożądany stan końcowy

Detekcja z garbled pierwszym słowem tytułu + dostępnym autorem → system automatycznie
proponuje poprawną książkę z score ≥ MATCH_MID (0.55) zamiast losowego 27%-owego trafienia.
Bez autora lub gdy wszystkie słowa < 5 znaków → fallback pominięty, zachowanie bez zmian.

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego |
|---|---|---|
| Gdzie fallback | `findCandidates.ts` post-scoring | Ma kontekst scores; `searchGoogleBooks` zostaje pure |
| Trigger | best score < MATCH_MID (0.55) | Nie fallbackuj gdy primary działa |
| Min długość słowa | ≥5 znaków | Krótsze → artykuły, przyimki → noise |
| Maks słów | 3 | Balans pokrycia vs API calls (max +3 × ~200ms) |
| Sortowanie | długość DESC | Najdłuższe = najbardziej unikalne |
| Guard na autora | tylko gdy rawAuthor != null | Bez filtra autorskiego zbyt wiele fałszywych trafień |
| Stop early | po pierwszym słowie ≥ MATCH_MID | Oszczędność API calls |
| Rate limit | break, zwróć co mamy | Spójne z istniejącą logiką |

## Zakres

**W zakresie:**
- `extractSignificantWords()` w `normalizeQuery.ts`
- Blok word-level fallback w `findCandidates.ts` (~20 linii)
- Testy jednostkowe: `normalizeQuery.test.ts` + nowy `findCandidatesWordFallback.test.ts`

**Poza zakresem:**
- Fallback bez autora
- OpenLibrary / BN w word-level
- Zmiany UI / API / DB

## Architektura / Podejście

```
findBookCandidates(rawTitle, rawAuthor)
  ├── Promise.all: GB + OL + BN  (istniejące)
  ├── score all candidates
  ├── sort
  ├── [NOWE] if best < 0.55 && rawAuthor:
  │     for word in extractSignificantWords(rawTitle).slice(0,3):
  │       result = searchGoogleBooks({title: word, author: rawAuthor})
  │       push + re-sort scored
  │       break if found ≥ 0.55
  ├── filter (≥ 0.25 && authorTokensMatch)
  ├── dedupeCandidates
  └── enrich cover
```

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
|---|---|---|
| 1. Helper + testy | `extractSignificantWords` + unit tests | brak — czysto izolowana funkcja |
| 2. Fallback + testy | Blok w `findCandidates.ts` + `findCandidatesWordFallback.test.ts` | Mutowalny `scored[]` — re-sort po push zachowuje kolejność |

**Wymagania wstępne:** żadne — zmiana czysto server-side, branch per change workflow.
**Szacowany nakład pracy:** ~1 sesja implementacji, 2 fazy.

## Otwarte ryzyka i założenia

- Zakładamy, że token ≥5 znaków jest wystarczająco specyficzny dla GB — ryzyko false positive
  dla pospolitych słów (np. "Miłość", "Wielki") minimalizowane przez `authorTokensMatch` filtr.
- Max +3 API calls po złym primary wyniku (~600ms wall-clock overhead) — akceptowalne w CF
  Workers 30s limicie.
- Brak prod test przed merge — weryfikacja manualna user-only po deploy.

## Kryteria sukcesu (podsumowanie)

- `npx vitest run tests/unit/lib/matching/` zielone (wszystkie nowe + istniejące)
- `npm run typecheck` i `npm run lint` przechodzą
- Detekcja "Słowcy Koszmarów + Marowska Duchowna" → propozycja "Siewcy Koszmarów" ≥ 0.55
  (weryfikacja manualna post-merge)
