# word-level-ocr-fallback

**Status:** implemented
**Updated:** 2026-06-24

## Opis

Word-level fallback w silniku matchingu (S-48): gdy OCR garbles pierwszy wyraz tytułu
(np. "Słowcy" zamiast "Siewcy"), pełna kaskada searchGoogleBooks wyczerpuje się i zwraca
losowe książki przez fallback `inauthor:`. Fallback wyodrębnia istotne słowa z rawTitle
(≥5 znaków, najdłuższe pierwsze) i próbuje je osobno jako zapytanie + autor, dopóki nie
znajdzie kandydata ≥ MATCH_MID (0.55) lub nie skończy max 3 słów.

## Zakres

- `src/lib/matching/normalizeQuery.ts` — nowa funkcja `extractSignificantWords`
- `src/lib/matching/findCandidates.ts` — blok word-level fallback po scoringu
- `tests/unit/lib/matching/normalizeQuery.test.ts` — testy nowej funkcji
- `tests/unit/lib/matching/findCandidatesWordFallback.test.ts` — nowy plik testów fallbacku

## Poza zakresem

- Zmiany w UI / API
- Zmiany w DB
- Fallback bez autora (zbyt szeroki wynik)
- OpenLibrary / BN dla word-level (dodatkowe źródła odraczamy)
