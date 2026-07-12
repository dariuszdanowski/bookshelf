# fix(rematch): wyszukiwanie po samym ISBN (bez tytułu) — BOOKSHELF-153

## Cel biznesowy

Naprawia [dariuszdanowski/bookshelf#153](https://github.com/dariuszdanowski/bookshelf/issues/153):
przycisk „Szukaj" na widoku zdjęcia/detekcji był zablokowany, dopóki user nie wpisał tytułu —
mimo że formularz ma osobne pole ISBN, które samo w sobie powinno wystarczyć (np. user zna tylko
ISBN z okładki, a nie zna/nie chce wpisywać tytułu).

## Zakres zmian

- `src/lib/books/schema.ts` — `RematchDetectionSchema`: `title` opcjonalny + `.refine`
  wymagający `title || isbn` (wzorzec skopiowany z istniejącego `SearchCandidatesSchema`).
- `src/pages/api/detections/[id]/rematch.ts` — przekazuje `isbnOnly` do `findBookCandidates`
  (jak w `src/pages/api/books/candidates.ts`); nie nadpisuje `raw_title` pustym stringiem, gdy
  user szukał tylko po ISBN (fallback do dotychczasowej wartości).
- `src/components/DetectionReview.tsx` — `RematchForm` i `AddMissedBookForm`: przycisk „Szukaj"
  odblokowany, gdy tytuł LUB ISBN jest wypełnione (usunięty `required` z inputu tytułu).

## Wynik walidacji i testów

- `npm run lint` — 0 błędów.
- `npx wrangler types && npx astro check` — 0 błędów, 0 ostrzeżeń.
- `npx vitest run` — **1085/1085** testów zielonych (92 pliki), w tym 2 nowe case'y (backend +
  komponent) dla ścieżki ISBN-only.
- `npm run build` — sukces.
- Playwright: `tests/e2e/manual-rematch.spec.ts` (12/12, w tym nowy scenariusz ISBN-only) i
  `tests/e2e/identity-first-flow.spec.ts` (6/6, dotyka `AddMissedBookForm`) — zielone.

## Wpływ na dokumentację i wiki

Nie dotyczy — naprawa istniejącego zachowania formularza, bez nowej funkcjonalności wymagającej
dokumentacji użytkownika. Projekt nie ma katalogu `confluence-docs/` ani panelu „Co nowego?".

## Wpływ na wdrożenie / restart / rollback

Brak zmian schematu bazy, brak nowych zmiennych środowiskowych, brak migracji. Zmiana czysto w
warstwie Zod/API/UI — standardowy deploy przez `deploy.yml` (merge → main). Rollback = revert PR,
bez dodatkowych kroków.
