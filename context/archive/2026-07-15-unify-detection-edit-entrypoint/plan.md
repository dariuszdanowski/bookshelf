# Jeden punkt wejścia do edycji detekcji — Plan implementacji

## Przegląd

Karta detekcji ma dziś trzy rozjechane ścieżki edycji (`RematchForm`-search, `CorrectForm`-manual,
`BookModal mode="propose"`-search+edit) rozproszone na dwa niespójne stany (match/no-match).
Ujednolicamy je: `BookModal.propose` (już ma pełne pola + „Wyszukaj po danych" z prefillem +
dwuetapowy zapis PATCH→confirm) staje się JEDYNYM miejscem edycji dla obu stanów. Dla no-match
dochodzi lekki „draft-kandydat" tworzony w momencie kliknięcia placeholdera okładki, żeby istniejący
flow PATCH/confirm zadziałał bez zmian kontraktu tych dwóch endpointów.

## Analiza stanu obecnego

Pełna tabela dowodów jest w `frame.md` (§ Badanie hipotez) — poniżej tylko to, co bezpośrednio
zasila fazy tego planu.

- **Trzy warianty prezentacji** (`src/components/DetectionReview.tsx`, 3837 linii): `DetectionCard`
  „Karty" (1201–1763), `DetectionRow` „Lista" (1804–2145, eksportowany), `DetectionTile` „Kafelki"
  (2162–2520, eksportowany). Wspólna logika już w hooku `useDetectionDecision` (779–1200) —
  duplikacja dotyczy WYŁĄCZNIE warstwy JSX.
- **Lista i Kafelki to niemal bajt-w-bajt kopie** (rząd akcji 1977–2053/2369–2445, no-match branch
  2016–2033/2408–2425) — różnią się tylko klasami Tailwind i propem `size` (`md` vs `sm`).
- **Karty strukturalnie inne**: osobny samodzielny blok no-match (1385–1417, dashed-border card),
  inny layout rzędu akcji (1574–1637, `size="lg"`, selektor alternatyw).
- **`BookModal mode="propose"`** montowany identycznie w 3 miejscach (1663–1678/2083–2098/2287–2302,
  diff = 0 linii) — `{showCandidateDetail && activeCandidate && (...)}`, więc dziś wymaga
  istniejącego `activeCandidate`.
- **`handleSaveCandidate()`/`doConfirmCandidate()` w `BookModal.tsx`** (677, 741) mają twardy guard
  `if (!book?.id || !book?.detectionId) return` — przyciski Zapisz/Zatwierdź są `disabled` bez tych
  pól (1122, 1130). Bez id nie da się użyć propose flow.
- **`PATCH /api/detections/[id]/candidate`** (`candidate.ts:64-71`) to czysty `UPDATE ... WHERE id =
  candidate_id AND detection_id = detectionId` — wymaga ISTNIEJĄCEGO wiersza, nie tworzy nowego.
- **`book_candidates` NOT NULL**: `source`, `external_id`, `title`, `rank` (`0001_initial_schema.sql:62-77`).
  **`source` CHECK dziś dopuszcza wyłącznie** `'google_books' | 'open_library' | 'national_library' |
  'ai_resolution'` (`0027_ai_book_resolution_substrate.sql:50-52`) — **`'manual'` nie jest
  dopuszczalną wartością**, więc utworzenie draft-kandydata bez migracji padnie na `23514`
  (check_violation).
- **`CoverImage`** (`DetectionReview.tsx:225-257`) ma WBUDOWANY fallback dla `url=null`/błędu
  ładowania — prosta ikona książki w szarym boxie. **Nic nowego nie trzeba projektować/rysować** —
  ten sam komponent użyty z `url={null}` jest gotowym placeholderem.
- **`correct.ts`** (`POST /api/detections/[id]/correct`) to JEDNOETAPOWY zapis: buduje `bookInput`
  z `cover_url: null`, `source: 'manual'`, `purchase_price: null` (94-110) i od razu woła
  `confirmDetectionToCatalog(...)` — inna semantyka niż propose (draft→confirm). Komentarz w kodzie
  (12-14) potwierdza: wariant `mode: 'field_edit'` jest już martwy, UI woła wyłącznie
  `mode="manual_entry"` (`DetectionReview.tsx:1444`, potwierdzone komentarzem linia 1766).
- **`WebSearchButton`** (`DetectionReview.tsx:100-140`, zwykły `<a target="_blank">` do Google, zero
  kosztu) i **`BookModal.tsx` `googleSearchUrl()`** (113-123, `book-modal-web-search` testid) to
  dwie osobne implementacje tego samego linku.
- **Testy dotknięte**: `tests/unit/components/DetectionReview.test.tsx` (m.in. `describe` bloki:
  „Popraw otwiera BookModal" ×2 warianty, „manual entry (no match)", „rematch..." ×5 bloków, „web
  search", „refine"), `tests/unit/components/BookModal.test.tsx` (`describe` „tryb propose..." ×3
  bloki), E2E: `tests/e2e/manual-rematch.spec.ts` (cały plik o RematchForm), `tests/e2e/
  proposal-accept-to-catalog.spec.ts`, `tests/e2e/unified-book-modal.spec.ts`, `tests/e2e/
  confirm-vision-rematch.spec.ts` (pośrednio, RefineButton confirm-dialog).

## Pożądany stan końcowy

Karta detekcji (we wszystkich 3 trybach prezentacji) ma dla stanu **match** dokładnie: Akceptuj,
Odrzuć, klikalną okładkę (już dziś, bez zmian) — **bez** osobnego przycisku „Szukaj po tytule". Dla
stanu **no-match**: Akceptuj-owi/Odrzuć odpowiada tylko Odrzuć (nie ma czego akceptować), plus
klikalny placeholder okładki (ikona z `CoverImage`, kursor lupki, tooltip „Pokaż szczegóły
książki" — identyczna interakcja jak dla dopasowanej książki) — **bez** „Szukaj po tytule" i
„Wpisz ręcznie". Klik (w obu stanach) otwiera **ten sam** `BookModal mode="propose"`: pełne pola,
„Wyszukaj po danych" (z automatycznym pierwszym wyszukiwaniem po otwarciu, jak dziś w trybie add),
„Oryginalny odczyt OCR" (nowość: dostępny również dla no-match i dla match), zapis dwuetapowy
(Zapisz = PATCH draft, Zatwierdź = POST confirm). `RematchForm`, `CorrectForm`,
`/api/detections/[id]/correct` i osobna implementacja `googleSearchUrl()` w BookModal są usunięte.

### Kluczowe odkrycia:

- `candidateToDetail()` (`DetectionReview.tsx:262-280`) już mapuje `BookCandidateDTO` →
  `BookModalBook` — nowy draft-kandydat (świeżo utworzony, puste pola) przechodzi przez TĘ SAMĄ
  funkcję bez zmian, jeśli endpoint tworzący draft zwróci kształt zgodny z `BookCandidateDTO`.
- `BookModal` już śledzi `saved`/`savedSnapshot` (research: „ustawia `savedSnapshot` i `saved=true`"
  po udanym PATCH) — wystarczający sygnał do rozróżnienia „user coś zapisał" vs „otworzył i
  zamknął bez zapisu" przy sprzątaniu porzuconych draftów.
- Migracja numer **0031** (najwyższa na `origin/main` to `0030_provider_timeout_and_resolution_provider.sql`).

## Czego NIE robimy

- Nie zmieniamy kontraktu `AiResolutionOutcome`/`resolve.ts`/`search_book` (osobny change
  `ai-resolution-search-tool`, w trakcie manualnej weryfikacji równolegle).
- Nie usuwamy `WebSearchButton`/`googleSearchUrl()` bez deduplikacji — **scalamy** je w jeden
  wspólny helper (decyzja usera), ale nie zmieniamy ich zachowania (wciąż zwykły link do Google,
  zero kosztu, zero API).
- Nie zmieniamy `RefineButton`/`/api/detections/[id]/refine` (poza zakresem — user o nim nie
  wspominał, zostaje jak dziś, w tym confirm-dialog z `confirm-vision-rematch`).
- Nie migrujemy istniejących wierszy `book_candidates` — migracja CHECK jest addytywna (dopuszcza
  nową wartość), zero backfillu.
- Nie zmieniamy `confirm.ts`/`confirmDetectionToCatalog` — draft-kandydat przechodzi przez te same,
  niezmienione endpointy co dziś dopasowany kandydat.
- Nie dodajemy per-user konfiguracji „ile razy user może otworzyć/porzucić draft" — sprzątanie
  porzuconych draftów jest bezwarunkowe (przy `onClose` bez zapisu), bez limitów/audytu.
- **Świadomie zaakceptowane ryzyko (plan-review F2)**: `shelves/[id]/photos.ts` (agregacja
  `stage`/`matched`) i `unreject.ts` liczą „≥1 wiersz `book_candidates`" jako „matched" bez
  filtra `source` — draft istniejący w DB od kliknięcia placeholdera do save/DELETE mógłby w tym
  wąskim oknie zostać policzony jako matched. Nie dodajemy filtra `source != 'manual'` w tej
  zmianie — okno jest wąskie (trwa tylko podczas otwartego modala), a te agregaty nie są
  odpytywane w tle w trakcie edycji karty. Rewizja tej decyzji, jeśli w przyszłości pojawi się
  dowód realnego wpływu na UX (np. user zgłosi migający licznik „dopasowane" na liście półek).

## Podejście do implementacji

`BookModal.propose` zostaje jedynym miejscem edycji. Dla no-match: klik placeholdera → `POST
/api/detections/[id]/candidate` (nowy handler tworzący pusty/draft wiersz `book_candidates`,
`source='manual'`) → otwarcie `BookModal` z id świeżo utworzonego draftu, identycznie jak dla
istniejącego kandydata. Migracja CHECK jest twardym prerequisitem (Faza 1) — bez niej insert
draftu nie przejdzie. Kolejność faz: backend → BookModal (obsługa no-match + OCR-revert) →
wpięcie UI (Karty/Lista/Kafelki niezależnie) → konsolidacja Lista+Kafelki → sprzątanie martwego
kodu → finalny sweep testów E2E.

## Krytyczne szczegóły implementacji

- **Porzucone drafty**: `DetectionReview` musi rozróżnić „otworzyłem BookModal z ISTNIEJĄCYM
  kandydatem" od „otworzyłem z ŚWIEŻO UTWORZONYM draftem". Dla drugiego przypadku, jeśli `onClose`
  odpali się bez uprzedniego `onCandidateSaved` (draft nigdy nie zapisany), trzeba wywołać
  sprzątanie (`DELETE`) tego konkretnego draft-wiersza — inaczej każdy klik „obejrzyj i zamknij"
  na no-match zostawia osierocony `book_candidates` wiersz, który zaśmieca `alts`/`top`
  candidate-selection logic dla tej detekcji przy kolejnym renderze.
- **`external_id` draftu**: `book_candidates.external_id` jest `NOT NULL` bez naturalnej wartości
  dla ręcznego wpisu — użyć syntetycznego `manual:${detectionId}` (konwencja nazewnictwa
  identyczna do `ai-resolution:${detectionId}` już używanego w `resolve.ts:238` dla source
  `ai_resolution` — precedens dotyczy WYŁĄCZNIE tego formatu nazwy; sam lifecycle „żywy
  draft-wiersz tworzony na klik, sprzątany DELETE-em przy porzuceniu" jest w tym repo nowym
  wzorcem, bez wcześniejszego precedensu — zob. plan-review F4).
- **`title` draftu**: `NOT NULL`, ale `detections.raw_title` bywa `null` dla no-match. Użyć
  `detection.raw_title ?? ''` — pusty string spełnia NOT NULL (nie wymaga fallbackowego tekstu),
  `BookModal` i tak pokaże pole tytułu jako edytowalne i puste.
- **Znany brzegowy przypadek (plan-review F3)**: `resolve.ts`/`refine.ts`/`rematch.ts`/`match.ts`/
  `match-stream.ts` robią nieskopowany `DELETE FROM book_candidates WHERE detection_id = X` przy
  ponownym dopasowaniu/doprecyzowaniu. Jeśli któryś z nich odpali się, gdy user ma otwarty
  `BookModal` z niezapisanym draftem dla tej samej detekcji, draft znika spod niego — kolejny
  `PATCH /candidate` dostanie jawny `404` (candidate.ts już to obsługuje, nie ciche uszkodzenie
  danych), ale user zobaczy niewyjaśniony błąd zapisu. Akceptowane świadomie — brak kodu w tej
  zmianie, tylko odnotowanie.

## Faza 1: Backend — migracja + tworzenie/usuwanie draft-kandydata

### Przegląd

Dodaje fundament DB + API, na którym oprze się reszta planu: nowa dopuszczalna wartość
`source='manual'` i dwa nowe handlery HTTP (create draft, delete unsaved draft) w istniejącym
`src/pages/api/detections/[id]/candidate.ts`.

### Wymagane zmiany:

#### 1. Migracja: dopuść `'manual'` w `book_candidates.source_check`

**Plik**: `supabase/migrations/0031_book_candidates_manual_source.sql`

**Cel**: Rozszerzyć istniejący CHECK constraint o wartość `'manual'`, żeby draft-kandydaty dla
no-match mogły być wstawiane bez naruszenia `23514`.

**Kontrakt**: Ten sam wzorzec co `0017`/`0027` (drop-by-lookup + re-add, odporne na
auto-wygenerowaną nazwę constraintu — `pg_constraint` + `pg_get_constraintdef` filtr `ilike
'%source%'`). Nowy zestaw dopuszczalnych wartości: `('google_books', 'open_library',
'national_library', 'ai_resolution', 'manual')`.

#### 2. `POST /api/detections/[id]/candidate` — utworzenie draft-kandydata

**Plik**: `src/pages/api/detections/[id]/candidate.ts`

**Cel**: Nowy handler `POST` (obok istniejącego `PATCH`) tworzący minimalny wiersz
`book_candidates` dla detekcji, która nie ma jeszcze żadnego kandydata — punkt wejścia dla
placeholdera okładki w stanie no-match.

**Kontrakt**: Body puste (`{}`) — wszystko wyprowadzane server-side z `detectionId` (RLS-scoped
pobranie `detections.raw_title` + weryfikacja własności). Insert: `source: 'manual'`,
`external_id: 'manual:' + detectionId`, `title: detection.raw_title ?? ''`, `authors: []`,
`rank: 1`, `detection_id: detectionId`. 201: `{ data: { candidate_id, title, authors, isbn_13:
null, isbn_10: null, publisher: null, published_year: null, cover_url: null } }` — kształt
zgodny z `BookCandidateDTO`, gotowy do `candidateToDetail()` bez zmian tej funkcji. 404: detekcja
nie istnieje/cudza. 409: detekcja ma już `status != 'pending'` (nie twórz draftu dla już
zdecydowanej detekcji).

#### 3. `DELETE /api/detections/[id]/candidate` — sprzątanie porzuconego draftu

**Plik**: `src/pages/api/detections/[id]/candidate.ts`

**Cel**: Usuwa dokładnie jeden, nigdy-nie-zapisany draft-kandydat (wywoływane z `onClose` w
`DetectionReview`, gdy user otworzył `BookModal` dla świeżo utworzonego draftu i zamknął bez
zapisu — zob. § Krytyczne szczegóły implementacji).

**Kontrakt**: Body `{ candidate_id: uuid }`. `DELETE ... WHERE id = candidate_id AND
detection_id = detectionId AND source = 'manual' AND edited_at IS NULL` — dodatkowy guard
`source='manual' AND edited_at IS NULL` chroni przed przypadkowym usunięciem realnego,
edytowanego kandydata (bezpieczeństwo > oszczędność zapytania). 200: `{ data: { deleted: true }
}` niezależnie od tego czy wiersz istniał (idempotentne — modal mógł już zostać zamknięty przez
inny event).

### Kryteria sukcesu:

#### Automatyczne:

- `npm run typecheck` przechodzi
- `npm run lint` przechodzi
- Nowe testy jednostkowe dla `POST`/`DELETE /api/detections/[id]/candidate` (happy path, 404,
  409 dla POST; happy path, guard `source='manual' AND edited_at IS NULL` dla DELETE) —
  `npx vitest run tests/unit/pages/api/detections/candidate.test.ts` zielone
- `npm run build` przechodzi

#### Ręczne:

- Migracja aplikuje się czysto na lokalnym stacku (`supabase migration up` — user-only, zob.
  CLAUDE.md § local Supabase)

---

## Faza 2: BookModal — obsługa no-match + „Oryginalny odczyt OCR"

### Przegląd

`BookModal mode="propose"` już działa dla istniejących kandydatów bez zmian kontraktu — ta faza
dodaje wyłącznie „Oryginalny odczyt OCR" (przeniesiony z `RematchForm`), dostępny niezależnie od
tego czy kandydat jest świeżym draftem czy prawdziwym matchem.

### Wymagane zmiany:

#### 1. „Oryginalny odczyt OCR" w `BookModal`

**Plik**: `src/components/BookModal.tsx`

**Cel**: Port logiki `handleUseOriginal` z `RematchForm` (`DetectionReview.tsx:504-555`) —
fetch `/api/detections/${detectionId}/history`, wypełnienie `title`/`authors` najwcześniejszym
`original_raw_*` (albo aktualnymi wartościami + hint „to już oryginał" gdy brak historii), reset
`publisher`/`isbn13`/`isbn10` do pustych (zgodnie z poprawką z tej samej sesji — OCR fizycznie
nie ma ISBN, zob. commit `c2ef75a`).

**Kontrakt**: Nowy przycisk w sekcji formularza propose (obok istniejących pól `BookFields"),
widoczny gdy `mode === 'propose' && book?.detectionId`. Reużywa dokładnie te same reguły co
poprawiony `RematchForm.handleUseOriginal` (obie gałęzie: z historią i „brak historii = bieżąca
wartość jest oryginałem").

### Kryteria sukcesu:

#### Automatyczne:

- `npm run typecheck` przechodzi
- `npm run lint` przechodzi
- Nowe testy w `tests/unit/components/BookModal.test.tsx` (`describe('BookModal — Oryginalny
  odczyt OCR w propose')`): z historią korekt, bez historii (hint), czyszczenie
  publisher/isbn — analogiczne do testów usuniętych w Fazie 5 z `RematchForm`

#### Ręczne:

- Brak — zachowanie widoczne dopiero po wpięciu w Fazie 3/4, weryfikacja tam.

---

## Faza 3: Placeholder okładki + wpięcie w Karty/Lista/Kafelki

### Przegląd

Dla każdego z 3 wariantów prezentacji: no-match dostaje klikalny placeholder (reużyty
`CoverImage` z `url={null}`, identyczna interakcja jak `candidate-cover-button`), klik tworzy
draft (Faza 1) i otwiera `BookModal` (Faza 2). Stary blok „Szukaj po tytule" + „Wpisz ręcznie"
(no-match) znika z UI (ale `RematchForm`/`CorrectForm` jako definicje zostają do Fazy 5 — inne
call site'y jeszcze ich używają, np. match-state „Szukaj po tytule").

### Wymagane zmiany:

#### 1. Placeholder + draft-creation hook — Karty

**Plik**: `src/components/DetectionReview.tsx` (`DetectionCard`, blok no-match 1385–1417)

**Cel**: Zastąpić tekstowy blok „Brak pewnego matchu" + `rematch-button`/`manual-entry-button`
klikalnym placeholderem (`<CoverImage url={null} title="" />` opakowanym w `<button>` z
`cursor-zoom-in` i `title="Pokaż szczegóły książki"`, identycznie jak `candidate-cover-button`
linia 1486–1497). `onClick`: `POST /api/detections/[id]/candidate` (Faza 1.2) → na sukces ustaw
lokalny stan `draftCandidateId` + `setShowCandidateDetail(true)` z tym draftem zamiast
`activeCandidate`.

**Kontrakt**: `showCandidateDetail && (activeCandidate || draftCandidate)` — mount `BookModal`
z `candidateToDetail(activeCandidate ?? draftCandidate, detection.id)`. `onClose` sprawdza: jeśli
otwarty był `draftCandidate` i nic nie zapisano (brak `onCandidateSaved` w tej sesji modala) →
`DELETE /api/detections/[id]/candidate` (Faza 1.3), potem `setDraftCandidate(null)`.

**Krytyczne (plan-review F1)**: `onCandidateSaved` we wszystkich 3 mount-pointach dziś robi
czysty `detection.candidates.map((c) => c.id === activeCandidate.id ? applyCandidatePatch(c,
patch) : c)` — dla świeżo utworzonego draftu, który NIGDY nie był w `detection.candidates`
(przyszedł z osobnego `POST`, nie z fetcha listy detekcji), ten `.map()` jest no-opem: karta
dalej pokazuje „Brak pewnego matchu" mimo zapisanych danych, a kolejny klik placeholdera tworzy
DRUGI draft (pierwszy staje się niewidocznym śmieciem do przeładowania strony — `edited_at` po
PATCH jest już ustawiony, więc DELETE-guard z Fazy 1.3 go nie posprząta). Callback musi rozróżnić
przypadki: `const target = activeCandidate ?? draftCandidate; const exists =
detection.candidates.some((c) => c.id === target?.id); candidates: exists ?
detection.candidates.map(...) : [...detection.candidates, { ...target, ...patch }]` — `patch`
(typ `CandidatePatch`) niesie tylko wysłane pola, więc gałąź „dodaj" musi zbudować pełny wpis z
`target` (draft/activeCandidate) + `patch`, nie z samego `patch`.

#### 2. Placeholder + draft-creation hook — Lista

**Plik**: `src/components/DetectionReview.tsx` (`DetectionRow`, gałąź no-match 2016–2033)

**Cel**: Analogicznie do 3.1, w kontekście `DetectionRow`.

**Kontrakt**: Ten sam wzorzec propsów/callbacków co 3.1 (ta sama logika `useDetectionDecision`
już współdzielona — tylko JSX się różni).

#### 3. Placeholder + draft-creation hook — Kafelki

**Plik**: `src/components/DetectionReview.tsx` (`DetectionTile`, gałąź no-match 2408–2425)

**Cel**: Analogicznie do 3.1/3.2, w kontekście `DetectionTile`.

**Kontrakt**: Jak wyżej.

### Kryteria sukcesu:

#### Automatyczne:

- `npm run typecheck` przechodzi
- `npm run lint` przechodzi
- Zaktualizowane testy w `tests/unit/components/DetectionReview.test.tsx` dla wszystkich 3
  wariantów: klik placeholdera → `POST /candidate` → `BookModal` otwarty z pustym drafttem;
  zamknięcie bez zapisu → `DELETE /candidate` wywołane; zapis → brak DELETE
- Nowy test: zapis draftu (`onCandidateSaved`) bez natychmiastowego potwierdzenia →
  `detection.candidates` lokalnie zawiera nowy wpis (nie zostaje pustą tablicą) — dowód że
  branch append (nie tylko map) faktycznie zadziałał (plan-review F1)

#### Ręczne:

- Dla każdego z 3 widoków (Karty/Lista/Kafelki): detekcja bez matcha pokazuje placeholder
  okładki zamiast starych przycisków, klik otwiera pełny `BookModal`, „Wyszukaj po danych" i
  „Oryginalny odczyt OCR" działają, Zapisz→Zatwierdź przenosi książkę do katalogu, zamknięcie
  bez zapisu nie zostawia śmiecia w bazie (weryfikacja: user sprawdza w Supabase Studio)

---

## Faza 4: Konsolidacja Lista + Kafelki

### Przegląd

Lista i Kafelki są (po Fazie 3) nadal niemal bajt-w-bajt identyczne — wydzielenie wspólnego
komponentu usuwa realny dług techniczny udokumentowany w researchu. Karty zostają osobnym,
świadomie nie-konsolidowanym wariantem (selektor alternatyw, inny layout).

### Wymagane zmiany:

#### 1. Wspólny komponent rzędu akcji

**Plik**: `src/components/DetectionActionsRow.tsx` (nowy)

**Cel**: Wydzielić rząd akcji (Akceptuj/Odrzuć/klikalna-okładka-lub-placeholder/WebSearch/Refine)
używany identycznie w `DetectionRow` i `DetectionTile` — jedyna różnica dziś to Tailwind
(`px-2.5` vs `px-2`, kontener `sm:flex-shrink-0` vs brak) i prop `size` (`md` vs `sm`), już
przekazywany do `WebSearchButton`/`RefineButton`.

**Kontrakt**: Props `size: 'md' | 'sm'`, reszta identyczna do dzisiejszych propsów przekazywanych
w oba miejsca (`detection`, `activeCandidate`, `busy`, handlery). Rozmiar-zależne klasy Tailwind
sterowane przez `size` zamiast literalnej duplikacji.

#### 2. Podmiana w `DetectionRow` i `DetectionTile`

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: Zastąpić zduplikowany JSX (2016–2053 w `DetectionRow`, 2408–2445 w `DetectionTile`)
wywołaniem `<DetectionActionsRow size="md" .../>` / `<DetectionActionsRow size="sm" .../>`.

**Kontrakt**: Zero zmian zachowania — czysty refaktor ekstrakcji, kryteria sukcesu = te same
testy z Fazy 3 nadal zielone bez zmian w treści testów (weryfikacja że ekstrakcja nie złamała
niczego).

### Kryteria sukcesu:

#### Automatyczne:

- `npm run typecheck` przechodzi
- `npm run lint` przechodzi
- Wszystkie testy z Fazy 3 dla wariantów Lista/Kafelki nadal przechodzą bez modyfikacji treści
  testów (dowód że refaktor jest behavior-preserving)

#### Ręczne:

- Brak — czysty refaktor, pokryty automatami z Fazy 3.

---

## Faza 5: Sprzątanie martwego kodu

### Przegląd

Po Fazach 3–4 stary blok no-match (`RematchForm`, `CorrectForm` wywoływane dla no-match) nie ma
już żadnych call site'ów w stanie no-match — ale `RematchForm` jest nadal wołany w stanie MATCH
(przycisk „Szukaj po tytule", 2 miejsca w Kartach + po 1 w Liście/Kafelkach = 4 razem). Ta faza
usuwa WSZYSTKIE pozostałe call site'y, definicje, martwy typ `field_edit`, i dedupe `WebSearchButton`.

### Wymagane zmiany:

#### 1. Usunięcie „Szukaj po tytule" (ostatnie call site'y `RematchForm`) ze stanu match

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: Usunąć `rematch-button` z rzędu akcji match-state (Karty 1605–1617, oraz w
`DetectionActionsRow` z Fazy 4 dla Lista/Kafelki) — edycja dopasowanej detekcji idzie teraz
wyłącznie przez klik okładki/„Popraw" → `BookModal`, który (Faza 2) ma już „Wyszukaj po danych" +
„Oryginalny odczyt OCR".

**Kontrakt**: Usunięcie JSX + towarzyszącego stanu (`showRematchForm`, `rematchNoResults`) tam,
gdzie nie jest już używany przez żadną gałąź.

#### 2. Usunięcie definicji `RematchForm`, `CorrectForm`, `/api/detections/[id]/correct`

**Pliki**: `src/components/DetectionReview.tsx` (definicje 480–709 i 317–453, wrapper
`DetectionCorrectionModal` 1768–1787), `src/pages/api/detections/[id]/correct.ts`

**Cel**: Po 5.1 i Fazie 3, `RematchForm` i `CorrectForm` nie mają już żadnego wywołania w
`DetectionReview.tsx` — usunąć definicje, powiązane typy (`RematchFormProps`,
`CorrectFormProps`, w tym martwy wariant `mode: 'field_edit'`), i sam endpoint `correct.ts`
(superseded przez ujednolicony flow PATCH/candidate + confirm.ts).

**Kontrakt**: Usunięcie plik/funkcje. Zero zmian w `confirm.ts`/`confirmDetectionToCatalog` —
tylko `correct.ts` jako plik znika.

#### 3. Dedup `WebSearchButton` / `googleSearchUrl()`

**Pliki**: `src/components/DetectionReview.tsx` (100-140), `src/components/BookModal.tsx` (113-123, 1034-1042)

**Cel**: Jedna wspólna implementacja linku „Szukaj w sieci" (np. wyodrębniona do
`src/components/WebSearchLink.tsx` albo `src/lib/books/webSearch.ts` dla samej funkcji
budującej URL) używana przez oba miejsca zamiast dwóch niezależnych kopii.

**Kontrakt**: Zachować oba istniejące `data-testid` (`web-search-button` w DetectionReview,
`book-modal-web-search` w BookModal) jako props/warianty jednego komponentu — testy E2E
referencujące te testidy nie wymagają zmian.

### Kryteria sukcesu:

#### Automatyczne:

- `npm run typecheck` przechodzi
- `npm run lint` przechodzi
- `npm run test` (pełna suita) — brak referencji do usuniętych `RematchForm`/`CorrectForm`/
  `correct.ts` w żadnym teście (stare `describe` bloki dla nich usunięte, nie tylko `skip`owane)
- `grep -rn "RematchForm\|CorrectForm\|detections/\[id\]/correct" src/ tests/unit/` — zero trafień
  poza `DetectionActionsRow`/nowymi plikami z Faz 1-4

#### Ręczne:

- Brak — pełne pokrycie automatami; weryfikacja end-to-end w Fazie 6.

---

## Faza 6: Finalny sweep E2E + manualny smoke test

### Przegląd

Konsolidacja/aktualizacja plików E2E dotkniętych zmianą, plus manualne potwierdzenie pełnego
przepływu w każdym z 3 widoków.

### Wymagane zmiany:

#### 1. `tests/e2e/manual-rematch.spec.ts` — retire/przepisanie

**Plik**: `tests/e2e/manual-rematch.spec.ts`

**Cel**: Cały plik dotyczy `RematchForm`, który już nie istnieje (Faza 5). Przepisać golden-path
scenariusze („Oryginalny odczyt OCR", wyszukiwanie po ISBN, brak wyników) na nowy flow
(placeholder → BookModal → Wyszukaj po danych / Oryginalny odczyt OCR), zachowując pokrycie tych
samych przypadków brzegowych co dziś (S-19 istniejący kandydat, ISBN-only, brak wyników).

**Kontrakt**: Nowe testy w `tests/e2e/proposal-accept-to-catalog.spec.ts` (już ma bloki dla
propose-flow) albo w przemianowanym `tests/e2e/unified-edit-entrypoint.spec.ts` — decyzja
nazewnictwa pliku należy do implementatora, kryterium sukcesu to zachowane pokrycie scenariuszy.

#### 2. Aktualizacja pozostałych spec'ów

**Pliki**: `tests/e2e/proposal-accept-to-catalog.spec.ts`, `tests/e2e/unified-book-modal.spec.ts`

**Cel**: Zaktualizować asercje odwołujące się do usuniętych testidów (`rematch-button`,
`manual-entry-button`, `correct-form` w kontekście no-match) na nowe (placeholder okładki).

### Kryteria sukcesu:

#### Automatyczne:

- `npm run test:e2e` (pełna suita Playwright, lokalny stack) zielone
- `npm run typecheck`, `npm run lint`, `npm run test` (unit) zielone — pełny gate przed PR

#### Ręczne:

- Golden path dla KAŻDEGO z 3 widoków (Karty/Lista/Kafelki): zdjęcie z detekcją bez matcha →
  klik placeholder → BookModal → Wyszukaj po danych → wybór kandydata → Zapisz → Zatwierdź →
  książka w katalogu
- Golden path dla dopasowanej detekcji: klik okładki → BookModal → Oryginalny odczyt OCR działa
  → Zapisz → Zatwierdź
- Regresja: zamknięcie BookModal dla świeżo utworzonego draftu BEZ zapisu → sprawdzić w Supabase
  Studio że wiersz `book_candidates` faktycznie zniknął (DELETE zadziałał)
- Regresja: „Szukaj w sieci" nadal działa identycznie w obu miejscach (DetectionReview + BookModal)

**Uwaga implementacyjna**: Po zakończeniu tej fazy i przejściu wszystkich automatycznych
weryfikacji, zatrzymaj się tutaj po ręczne potwierdzenie smoke testu, zanim change zostanie
uznany za gotowy do `/10x-archive`.

---

## Strategia testowania

### Testy jednostkowe:

- Nowy endpoint create/delete draft (Faza 1) — happy path + guardy (404/409, `source='manual' AND
  edited_at IS NULL`).
- „Oryginalny odczyt OCR" w `BookModal` (Faza 2) — z historią, bez historii, czyszczenie
  publisher/isbn.
- Placeholder + draft lifecycle we wszystkich 3 wariantach (Faza 3) — klik→POST, close-bez-save→
  DELETE, save→brak DELETE.
- Ekstrakcja `DetectionActionsRow` (Faza 4) — istniejące testy Fazy 3 jako regression gate.
- Usunięcie martwego kodu (Faza 5) — grep-based dowód braku referencji + pełna suita zielona.

### Testy integracyjne:

- Brak nowych — moduł nie zmienia RLS ani wielotabelowych transakcji poza tym co już istnieje w
  `confirmDetectionToCatalog` (niezmienione).

### Kroki testowania ręcznego:

1. Wgraj zdjęcie z co najmniej jedną książką bez pewnego matchu i jedną z matchem.
2. Dla widoku Karty: sprawdź placeholder okładki (no-match) i klikalną okładkę (match) — oba
   otwierają ten sam `BookModal`.
3. Przełącz na widok Lista, potem Kafelki — powtórz krok 2, sprawdź że zachowanie identyczne.
4. W `BookModal` dla no-match: „Wyszukaj po danych" (auto-search po otwarciu), wybór kandydata,
   „Oryginalny odczyt OCR", Zapisz, Zatwierdź.
5. Otwórz placeholder dla innej no-match detekcji, zamknij bez zapisu — sprawdź w Supabase Studio
   brak osieroconego wiersza `book_candidates`.
6. „Szukaj w sieci" z obu miejsc (karta + wewnątrz BookModal) prowadzi do tego samego wyszukiwania
   Google.

## Uwagi dotyczące wydajności

Draft-kandydat to jeden dodatkowy `INSERT`/`DELETE` per otwarcie-i-porzucenie edycji no-match —
zaniedbywalny koszt (bez zewnętrznych wywołań API, sam Postgres). Brak zmian w ścieżkach
wysokiego ruchu (list photos, list shelves).

## Uwagi dotyczące migracji

Migracja `0031` jest addytywna (rozszerza CHECK, nie zmienia istniejących wierszy) — bezpieczna
do `db push` na prod bez przestoju, zgodnie z regułą repo (migracje po merge do main, automatyczne
w `deploy.yml`).

## Referencje

- Brief ramowy: `context/changes/unify-detection-edit-entrypoint/frame.md`
- `src/components/DetectionReview.tsx` (cały plik, 3837 linii — kluczowe zakresy w tekście planu)
- `src/components/BookModal.tsx` (cały plik)
- `src/pages/api/detections/[id]/candidate.ts`, `confirm.ts`, `correct.ts`
- `supabase/migrations/0001_initial_schema.sql`, `0017_book_candidates_national_library.sql`,
  `0027_ai_book_resolution_substrate.sql`
- `context/archive/2026-06-06-unified-book-modal/plan.md` (pierwotna intencja konsolidacji)
- `context/foundation/lessons.md` → „Przed migracją sprawdź max numer na main", „Testy przed lub
  razem z każdą zmianą"

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dołącz ` — <commit sha>` po zakończeniu kroku.

### Faza 1: Backend — migracja + tworzenie/usuwanie draft-kandydata

#### Automatyczne

- [x] 1.1 `npm run typecheck` przechodzi
- [x] 1.2 `npm run lint` przechodzi
- [x] 1.3 Nowe testy jednostkowe dla POST/DELETE `/api/detections/[id]/candidate` zielone
- [x] 1.4 `npm run build` przechodzi

#### Ręczne

- [x] 1.5 Migracja 0031 aplikuje się czysto na lokalnym stacku

### Faza 2: BookModal — obsługa no-match + „Oryginalny odczyt OCR"

#### Automatyczne

- [x] 2.1 `npm run typecheck` przechodzi
- [x] 2.2 `npm run lint` przechodzi
- [x] 2.3 Nowe testy „Oryginalny odczyt OCR w propose" zielone

### Faza 3: Placeholder okładki + wpięcie w Karty/Lista/Kafelki

#### Automatyczne

- [x] 3.1 `npm run typecheck` przechodzi — e8e158d
- [x] 3.2 `npm run lint` przechodzi — e8e158d
- [x] 3.3 Zaktualizowane testy dla 3 wariantów (placeholder→POST, close→DELETE, save→brak DELETE) zielone — e8e158d

#### Ręczne

- [x] 3.4 Dla każdego z 3 widoków: placeholder działa, BookModal się otwiera, zapis działa,
      zamknięcie bez zapisu nie zostawia śmiecia w bazie — e8e158d

### Faza 4: Konsolidacja Lista + Kafelki

#### Automatyczne

- [x] 4.1 `npm run typecheck` przechodzi — ed83fe4
- [x] 4.2 `npm run lint` przechodzi — ed83fe4
- [x] 4.3 Testy Fazy 3 dla Lista/Kafelki nadal zielone bez zmian treści testów — ed83fe4

### Faza 5: Sprzątanie martwego kodu

#### Automatyczne

- [x] 5.1 `npm run typecheck` przechodzi — 2fe02e9
- [x] 5.2 `npm run lint` przechodzi — 2fe02e9
- [x] 5.3 `npm run test` (pełna suita) zielone — 2fe02e9
- [x] 5.4 Grep potwierdza zero referencji do RematchForm/CorrectForm/correct.ts poza oczekiwanymi — 2fe02e9

### Faza 6: Finalny sweep E2E + manualny smoke test

#### Automatyczne

- [x] 6.1 `npm run test:e2e` zielone — ec5f1e8
- [x] 6.2 `npm run typecheck`, `npm run lint`, `npm run test` (pełny gate) zielone — ec5f1e8

#### Ręczne

- [x] 6.3 Golden path no-match dla 3 widoków (placeholder → BookModal → Wyszukaj po danych → Zapisz → Zatwierdź) — ec5f1e8
- [x] 6.4 Golden path match: Oryginalny odczyt OCR działa w BookModal — ec5f1e8
- [x] 6.5 Zamknięcie bez zapisu nie zostawia osieroconego wiersza (sprawdzone w Supabase Studio) — ec5f1e8
- [x] 6.6 „Szukaj w sieci" identyczny z obu miejsc — ec5f1e8
