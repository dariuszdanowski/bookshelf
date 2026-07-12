# Plan: BOOKSHELF-153 — wyszukiwanie po samym ISBN (bez tytułu)

## Kontekst

GitHub Issue [dariuszdanowski/bookshelf#153](https://github.com/dariuszdanowski/bookshelf/issues/153):
przycisk „Szukaj" na widoku zdjęcia/detekcji (`/photos/[id]`) jest zablokowany, dopóki user nie
wpisze tytułu — mimo że formularz ma osobne pole ISBN, które w praktyce mogłoby samodzielnie
wystarczyć do znalezienia książki (np. user zna tylko ISBN z okładki, nie zna/nie chce wpisywać
tytułu).

Ten sam wzorzec „wyszukiwanie po tytule i/lub ISBN, sam ISBN wystarcza" jest już poprawnie
zaimplementowany gdzie indziej w tym samym repo:
- `src/lib/matching/findCandidates.ts` ma opcję `isbnOnly` (linia 15-19) właśnie do tego celu.
- `src/pages/api/books/candidates.ts` + `SearchCandidatesSchema` (`src/lib/books/schema.ts:298-308`)
  poprawnie wymagają `title || isbn` (nie tylko `title`).
- `src/components/BookModal.tsx:333` już ma `disabled={busy || (!title.trim() && !isbn.trim())}`.

Bug dotyczy dwóch bliźniaczych formularzy w `src/components/DetectionReview.tsx`, które nie
zostały zaktualizowane do tego wzorca: `RematchForm` (widok zdjęcia zgłoszony w issue) i
`AddMissedBookForm` (dodawanie pominiętej książki, identyczny kod/endpoint). Oba wołają
`POST /api/detections/[id]/rematch`, którego Zod schema (`RematchDetectionSchema`) i logika
endpointu również twardo wymagają tytułu.

`CorrectForm` (tryb `field_edit`/`manual_entry`, ten sam plik) nie ma pola ISBN i nie jest
formularzem wyszukiwania zewnętrznego — świadomie poza zakresem.

## Snapshot danych GitHub Issue (bazowy)

```json
{
  "issue": {
    "key": "dariuszdanowski/bookshelf#153",
    "summary": "Bug: wyszkiwanie po tytule - powinno byc możliwe tez tylko po isbn",
    "description": "wyszkiwanie po tytule - powinno byc możliwe tez tylko po isbn / teraz przycisk szukaj jest zablokowany jak nie ma nazwy / URL: /photos/4af2f0b6-5d6c-47bc-9b4b-7989ee20b372"
  },
  "state": "open",
  "labels": [],
  "comments": []
}
```

## Fingerprint danych GitHub Issue (bazowy)

`sha256:1184420a6d0bf6fcdac5ccae2877b6845bfb462c8aa7d5bc3ddadcc837b885b1`

## Pliki do zmiany

1. `src/lib/books/schema.ts` — `RematchDetectionSchema` (linie 287-293): `title` z `min(1)`
   wymaganego na opcjonalny + `.refine` wymagający `title || isbn` (wzorzec z
   `SearchCandidatesSchema`).
2. `src/pages/api/detections/[id]/rematch.ts` — dodać `raw_title` do selecta detekcji (linia 74),
   policzyć `isbnOnly = !rawTitle.trim() && !!rawIsbnFromForm`, przekazać do
   `findBookCandidates(..., { publisher, isbnOnly })`, i nie nadpisywać `raw_title` pustym
   stringiem gdy tytuł nie podany (fallback do istniejącego `detection.raw_title`).
3. `src/components/DetectionReview.tsx`:
   - `RematchForm` (linie 382-386, 397-404, 454): `handleSubmit` gate + `disabled` z
     `!title.trim()` na `!title.trim() && !isbn.trim()`, usunięcie `required` z inputu tytułu.
   - `AddMissedBookForm` (linie 1995-1999, 2010-2017, 2068): analogiczna zmiana.
4. Testy: `tests/unit/pages/api/detections/id/rematch.test.ts`,
   `tests/unit/components/DetectionReview.test.tsx` (nowe case'y), ew. dopisek w
   `tests/e2e/manual-rematch.spec.ts` dla ścieżki ISBN-only.

## Zmiany SQL

Brak — zmiana czysto w warstwie Zod/API/UI, bez zmian schematu bazy.

## Nowe komponenty/funkcje

Brak nowych komponentów — rozszerzenie istniejącej logiki wg już obecnego w repo wzorca
(`isbnOnly`, `SearchCandidatesSchema`).

## Testy

- Unit (`rematch.test.ts`): nowy case „200 gdy podano tylko ISBN (bez tytułu)" — mock
  `searchGoogleBooks` zwraca kandydata, body `{ title: '', isbn: '9788308073087' }`, oczekiwane
  `applied: true` + że `raw_title` w update/response NIE zostaje nadpisane pustym stringiem
  (fallback do istniejącego `detection.raw_title` z mocka).
- Unit: istniejący case „400 gdy pusty tytuł" (linia 161-167, body `{ title: '' }` bez isbn)
  zostaje bez zmian — nadal 400, bo ani tytuł, ani ISBN.
- Unit (`DetectionReview.test.tsx`): nowy case — otwórz `rematch-form`, wypełnij tylko
  `rematch-isbn`, sprawdź że `rematch-submit` NIE jest disabled i submit wywołuje fetch z
  `title: ''`. Analogicznie dla `add-missed-isbn`/`add-missed-submit`.
- E2E (`manual-rematch.spec.ts`): opcjonalny dopisek — wypełnienie tylko ISBN i submit prowadzi
  do wyników (mock `page.route`), zgodnie z regułą „E2E przy każdej zmianie".

## Kontrakt UX i Interakcji

- Stan domyślny: oba pola (tytuł, ISBN) puste, przycisk disabled (bez zmian).
- Semantyka: przycisk odblokowuje się gdy **którekolwiek** z pól (tytuł LUB ISBN) ma niepustą
  wartość po `trim()` — spójne z `BookModal.tsx`.
- Tryb aktualizacji: bez zmian — submit robi fetch do tego samego endpointu.
- Usunięcie atrybutu HTML `required` z inputu tytułu (natywna walidacja przeglądarki blokowała
  submit niezależnie od stanu `disabled`).
- Etykieta pola tytułu zostaje „Tytuł" (bez zmiany tekstu) — pole ISBN już ma dopisek
  „(opcjonalnie — gdy tytuł nie daje wyników)", który w tym kontekście nadal ma sens (tytuł też
  jest teraz opcjonalny, ale priorytetowy — najlepsze wyniki daje kombinacja obu).

## Pytania doprecyzowujące

Brak pytań `OPEN` — wzorzec rozwiązania (title-lub-isbn, `isbnOnly`) jest już jednoznacznie
ustalony i działający gdzie indziej w repo (`BookModal.tsx`, `candidates.ts`). Decyzja: zamiast
wymyślać nowy kontrakt, replikujemy istniejący.

## Weryfikacja dokumentacji do uzupełnienia

- `INSTRUKCJA.md`/README: nie dotyczy — brak dedykowanej sekcji opisującej formularz rematch;
  zmiana jest naprawą istniejącego zachowania, nie nową funkcją wymagającą dokumentacji usera.
- `confluence-docs/`: nie dotyczy — katalog nie istnieje w tym repo (projekt kursowy 10xDevs, brak
  integracji Confluence).
- Panel „Co nowego?": moduł nie istnieje w tym projekcie — nie dotyczy.

## Zmiany dokumentacji i wiki

Nie dotyczy (patrz wyżej).

## Ryzyko i uwagi

- Ryzyko: `findBookCandidates` z pustym `title` i `isbnOnly=false` (domyślne) mogłoby dawać gorsze
  wyniki niż z `isbnOnly=true` — dlatego flaga musi być przekazywana warunkowo, dokładnie jak w
  `candidates.ts`.
- Ryzyko: nadpisanie `raw_title` pustym stringiem przy ISBN-only submit zepsułoby wyświetlanie
  tytułu detekcji gdzie indziej w UI — zaadresowane fallbackiem do istniejącego `raw_title`.
- Backward compatibility: zmiana wyłącznie rozluźnia walidację (title staje się opcjonalny, ale
  wymagany jest title LUB isbn) — żadna istniejąca ścieżka z samym tytułem się nie zmienia.

## Kroki realizacji

1. Rozluźnić `RematchDetectionSchema` (title opcjonalny + refine title||isbn).
2. Zaktualizować `rematch.ts`: select `raw_title`, policzyć `isbnOnly`, przekazać do
   `findBookCandidates`, fallback `raw_title` przy pustym tytule.
3. Zaktualizować `RematchForm` i `AddMissedBookForm` w `DetectionReview.tsx` (disabled/handleSubmit/required).
4. Dopisać/zaktualizować testy unit (rematch.test.ts, DetectionReview.test.tsx).
5. Uruchomić `npm run lint`, `npx astro check` (lub `npm run typecheck`), `npm run test:unit` (lub
   `npx vitest run` celowane pliki), pełny `npx vitest run` na końcu.
6. Uruchomić Playwright dla `manual-rematch.spec.ts` (lokalnie, WSL stack) — zgodnie z regułą
   „E2E przed manualnym testem".

## Strategia API

Brak nowych endpointów. Zmiana kontraktu istniejącego `POST /api/detections/[id]/rematch`:
`title` w body staje się opcjonalny (był wymagany), walidacja przenosi się na `title || isbn`.
Brak zmian w kształcie odpowiedzi.

## Najgorszy przypadek

User wpisuje tylko ISBN, które nie istnieje w żadnym źródle (GB/OL/BN) → `candidates: []`,
`applied: false`, tak jak dziś dla nietrafionego tytułu — brak regresji, zachowanie spójne.

## Realizacja

Zaimplementowano dokładnie wg planu:

1. `src/lib/books/schema.ts` — `RematchDetectionSchema`: `title` opcjonalny (`.trim().max(300).optional()`) + `.refine((v) => !!(v.title || v.isbn))`.
2. `src/pages/api/detections/[id]/rematch.ts`: select rozszerzony o `raw_title`, policzony `isbnOnly = !rawTitle && !!rawIsbnFromForm`, przekazany do `findBookCandidates(..., { publisher, isbnOnly })`; dodano `resolvedTitle = title || (detection.raw_title ?? '')` używany zarówno w `.update()`, jak i w obu miejscach response body (żeby ISBN-only submit nie nadpisywał `raw_title` pustym stringiem).
3. `src/components/DetectionReview.tsx`:
   - `RematchForm`: `handleSubmit` gate i `disabled` na przycisku zmienione z `!title.trim()` na `!title.trim() && !isbn.trim()`; usunięty `required` z inputu tytułu.
   - `AddMissedBookForm`: analogicznie.
4. Testy:
   - `tests/unit/pages/api/detections/id/rematch.test.ts` — nowy case „200 gdy podano tylko ISBN" + rozszerzony typ mocka `detection.raw_title`.
   - `tests/unit/components/DetectionReview.test.tsx` — nowy `describe` „rematch po samym ISBN (S-153)" z asercją disabled/enabled i treści body fetch.
   - `tests/e2e/manual-rematch.spec.ts` — nowy test „S-153: Szukaj odblokowany i działa gdy wypełniono tylko ISBN".

### Weryfikacja techniczna

- `npm run lint` — 0 błędów.
- `npx wrangler types && npx astro check` — 0 błędów, 0 ostrzeżeń (327 plików, tylko pre-istniejące hints).
- `npx vitest run` — 1085/1085 testów zielonych (92 pliki), w tym oba nowe case'y.
- `npm run build` — sukces.
- `npx playwright test tests/e2e/manual-rematch.spec.ts` — 12/12 zielone (11 istniejących + 1 nowy).
- `npx playwright test tests/e2e/identity-first-flow.spec.ts` — 6/6 zielone (dotyka `AddMissedBookForm`, jedyny inny spec z pokryciem zmienionych test-id).
- Grep po `tests/e2e/` potwierdził, że tylko te dwa specy dotykają zmienionych test-id (`rematch-title`, `rematch-submit`, `add-missed-title`, `add-missed-submit`) — pełny 28-specowy przebieg E2E świadomie pominięty jako nieproporcjonalny do zakresu zmiany (scoped E2E coverage).

## Weryfikacja spójności danych GitHub Issue

Ponowny odczyt (`gh-issue-fingerprint`) po implementacji: `currentFingerprint` =
`sha256:1184420a6d0bf6fcdac5ccae2877b6845bfb462c8aa7d5bc3ddadcc837b885b1` — identyczny z
fingerprintem bazowym z Kroku 1. `skipReason: no-source-change`. **Status: MATCH.** Issue nie
zmieniło się od triage (`state: open`, brak nowych komentarzy, brak zmiany labeli).

## Weryfikacja planu i realizacji względem aktualnego GitHub Issue

Checklista wymagań z issue #153:

- [x] „wyszukiwanie po tytule - powinno być możliwe też tylko po ISBN" — `RematchDetectionSchema`
      akceptuje sam ISBN; `RematchForm`/`AddMissedBookForm` submitują z pustym tytułem.
- [x] „teraz przycisk szukaj jest zablokowany jak nie ma nazwy" — `disabled` zmieniony na
      `!title.trim() && !isbn.trim()` w obu formularzach; `required` usunięty z inputu tytułu.
- [x] Zgłoszony URL (`/photos/[id]`) — to dokładnie widok renderujący `RematchForm` (potwierdzone
      researchem kodu przed planem).

Wszystkie punkty z opisu issue zaadresowane. **Decyzja: COMPLETE.**

## Kryteria zakończenia

- [x] `RematchDetectionSchema` akceptuje `{ isbn: '...' }` bez `title`.
- [x] `rematch.ts` nie nadpisuje `raw_title` pustym stringiem przy ISBN-only.
- [x] Przycisk „Szukaj" w `RematchForm` i `AddMissedBookForm` odblokowany gdy tylko ISBN wypełnione.
- [x] Wszystkie istniejące testy unit/E2E nadal zielone (bez regresji).
- [x] Nowe testy pokrywają ścieżkę ISBN-only (unit backend + unit component + E2E).
- [x] `npm run lint` + typecheck + `vitest run` + `build` zielone.
