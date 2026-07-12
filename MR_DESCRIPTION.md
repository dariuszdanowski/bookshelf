# fix(rematch): ISBN-only search — poprawny score + zastępowanie starych kandydatów

## Cel biznesowy

Follow-up do [dariuszdanowski/bookshelf#153](https://github.com/dariuszdanowski/bookshelf/issues/153),
wykryty w manualnym teście po zmergowaniu pierwszej naprawy (PR #155). Wyszukiwanie po samym ISBN
technicznie działało (przycisk odblokowany, backend przyjmował zapytanie), ale w praktyce:

1. Znaleziony kandydat dostawał pewność dopasowania ~20% zamiast bliskiej 100%, mimo identyfikacji
   po globalnie unikalnym numerze ISBN.
2. Gdy detekcja miała już zapisanego wcześniej, błędnego kandydata z wyższym (ale fałszywym)
   `matchScore`, konserwatywna polityka zastępowania blokowała podmianę na poprawny wynik.

## Zakres zmian

- `src/lib/matching/score.ts` — nowy `EXACT_ISBN_MATCH_SCORE` (0.97) jako floor, gdy zapytany ISBN
  dokładnie odpowiada `isbn10`/`isbn13` kandydata (z konwersją formatu 10↔13). `Detection` przyjmuje
  teraz opcjonalne pole `isbn`.
- `src/lib/matching/findCandidates.ts` — przekazuje `rawIsbn` do `scoreCandidate` w obu miejscach
  scoringu.
- `src/pages/api/detections/[id]/rematch.ts` — `shouldReplace` zawsze `true` dla `isbnOnly` search
  (świadoma, jawna akcja usera z zewnętrznym identyfikatorem — nie podlega marginesowi
  konserwatywnemu).
- `context/foundation/roadmap.md` — dopisany `S-50` (proposed): osobny, pokrewny problem — OCR
  odczytujący tytuł w niewłaściwej formie gramatycznej (liczba mnoga/pojedyncza) może nie trafić
  w wyniki wyszukiwania zewnętrznych źródeł. Poza zakresem tego PR.

## Wynik walidacji i testów

- `npm run lint` — 0 błędów.
- `npx wrangler types && npx astro check` — 0 błędów, 0 ostrzeżeń.
- `npx vitest run` — **1092/1092** testów zielonych (92 pliki), w tym nowe case'y dla
  `EXACT_ISBN_MATCH_SCORE` (score.test.ts) i regresja „ISBN-only zastępuje istniejącego,
  lepiej ocenionego kandydata" (rematch.test.ts). Zaktualizowano jeden istniejący test
  (`findCandidatesIsbn.test.ts`), który zakładał stare (mniej poprawne) zachowanie.
- `npm run build` — sukces.
- Zweryfikowane manualnie na żywo (lokalny dev server + lokalny Supabase): dokładnie odtworzony
  scenariusz z manualnego testu #153 (ISBN `9788379999484`, książka „Złodzieje książek") — teraz
  zwraca poprawnego kandydata z wysoką pewnością i zastępuje wcześniejszego, błędnego.

## Wpływ na dokumentację i wiki

Roadmapa (`S-50`) zaktualizowana o nowy, pokrewny pomysł (proposed, nie blokuje tego PR).

## Wpływ na wdrożenie / restart / rollback

Brak zmian schematu bazy, brak migracji. Rollback = revert PR.
