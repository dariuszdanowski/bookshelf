# Popraw jako pełna edycja propozycji kandydata — Plan implementacji

## Przegląd

Zastępujemy dzisiejsze „Popraw" — formularz `CorrectForm mode="field_edit"`, który edytuje pola i **natychmiast** zatwierdza detekcję jako książkę w jednym kroku (`POST /api/detections/[id]/correct`) — dwuetapowym flow opartym o istniejący `BookModal mode="propose"` (rozbudowany w `candidate-cover-override` o edytowalną okładkę):

1. **Zapisz** — PATCH wszystkich edytowalnych pól (tytuł, autorzy, ISBN-10/13, wydawca, rok, okładka, dane zakupu) bezpośrednio do `book_candidates`, bez zatwierdzania.
2. **Zatwierdź** — osobny, jawny krok wołający istniejący, niezmieniony `POST /api/detections/[id]/confirm`, który już dziś czyta świeże dane kandydata z DB.

Wariant `manual_entry` (detekcja bez kandydata, przycisk „Wpisz ręcznie") **zostaje bez zmian** — nie ma wiersza `book_candidates`, do którego dałoby się PATCH-ować.

## Analiza stanu obecnego

- `confirm.ts` (`POST /api/detections/[id]/confirm`) już SELECT-uje świeże `title, authors, isbn_10, isbn_13, publisher, published_year, cover_url` z `book_candidates` w momencie zatwierdzania i buduje z nich wpis w `books` — **zero zmian potrzebnych w tym mechanizmie**, jeśli pola zostaną wcześniej wyedytowane PATCH-em. Jedyna luka: dziś zawsze twardo koduje `correctionType: 'accept'`, nie wiedząc, że kandydat był edytowany.
- RLS `book_candidates_update_own` (migracja `0002`) to **jedna blankietowa polityka UPDATE** przez `detection_id → photos.user_id`, bez ograniczeń per-kolumna — PATCH na title/authors/isbn/publisher/year jest już dziś dozwolony przez RLS.
- Dedup po ISBN w `confirmDetectionToCatalog` (krok 1, pre-check `isbn_13`) działa na **bieżącym** stanie kandydata w chwili zatwierdzania — jeśli user zmieni ISBN przed zatwierdzeniem, dedup automatycznie zobaczy nowy ISBN. Zero dodatkowej pracy.
- `book_candidates.title` jest `NOT NULL`, `authors` domyślnie `'{}'` — ta sama walidacja co istniejący wzorzec `UpdateBookSchema`.
- Trzy miejsca renderowania w `DetectionReview.tsx` obsługują „Popraw" DZIŚ różnie:
  - **Karty** (`DetectionCard`, ~L1059): „Popraw" (`top` istnieje) → inline `CorrectForm mode="field_edit"` (stan `showCorrectForm`, dzielony z gałęzią `manual_entry` dla `!top`). Osobno: klik w okładkę → `showCandidateDetail` → `BookModal mode="propose"` (dziś edytowalna tylko okładka, z `candidate-cover-override`).
  - **Lista** (`DetectionRow`, ~L1661): „Popraw" → `showModal` → `DetectionCorrectionModal` (wrapper) → `CorrectForm mode={hasMatch ? 'field_edit' : 'manual_entry'}`. **Brak** klik-w-okładkę / podglądu kandydata w ogóle.
  - **Kafelki** (`DetectionTile`, ~L1972): **DWIE równoległe ścieżki do tego samego kandydata** — klik w okładkę → `showCandidateDetail` → `BookModal mode="propose"` (tylko okładka), ORAZ „Popraw" → `showModal` → `DetectionCorrectionModal` → `CorrectForm mode="field_edit"`.
- `confirm-batch.ts` (bulk-accept pre-zaznaczonych) ma **własną, trzecią kopię** logiki budowania `book` z `book_candidates` + twardo zakodowane `correctionType: 'accept'` — analogiczna luka jak w `confirm.ts`, musi dostać to samo traktowanie (inaczej bulk-accept edytowanego kandydata cicho zgubi telemetrię i override zakupu).
- `corrections.correction_type` CHECK constraint (migracja `0028`) już dopuszcza `'field_edit'` — nie potrzeba nowej wartości enuma, tylko innego sposobu jej ustawiania.
- `PurchaseSection` (komponent) i jego pola żyją dziś na `photos` (per-zdjęcie, kopiowane do `books` dopiero przy `confirm`) — `book_candidates` ich nie ma.

### Kluczowe odkrycia:

- `candidateToDetail()` (`DetectionReview.tsx`) i `BookCandidateDTOSchema` (`src/lib/books/schema.ts:38`) nie niosą dziś pól zakupu — trzeba je dodać w DTO + w SELECT `GET /api/photos/[id]` (`src/pages/api/photos/[id].ts:196`).
- `BookModalBook` (typ, `BookModal.tsx:42`) **już ma** pola `purchase_date/purchase_price/purchase_city/purchase_event` z poprzednich zmian (add/edit mode) — nic do dodania w tym typie.
- `ConfirmBookInput` (typ, `src/lib/books/confirm.ts`) **nie ma** pola `purchase_price` — `books.purchase_price` istnieje (migracja `0026`), ale confirm-path nigdy go nie ustawiał (price zawsze był edytowany dopiero post-confirm w edit mode). Trzeba dodać pole + przekazać je do `INSERT books`.
- `photos` nie ma kolumny `purchase_price` w ogóle — dla kandydata nie ma więc fallbacku do photo dla ceny, tylko `candidate.purchase_price ?? null`.

## Pożądany stan końcowy

User klika „Popraw" na dowolnej detekcji z kandydatem (Karty/Lista/Kafelki) → otwiera się `BookModal mode="propose"` z wszystkimi polami edytowalnymi (tytuł, autorzy, wydawca, rok, ISBN-10/13, okładka, dane zakupu) + dostępnym „Wyszukaj po danych". Klik „Zapisz" PATCH-uje `book_candidates` i pokazuje potwierdzenie, karta pod spodem odświeża podgląd (bez przeładowania strony), modal zostaje otwarty. Klik „Zatwierdź" — jeśli są niezapisane zmiany, pyta „zapisać i zatwierdzić?" (Anuluj = zostań w modalu bez akcji, Potwierdź = zapisz + zatwierdź); jeśli brak zmian, od razu woła istniejący `/confirm`. Po sukcesie karta przechodzi w stan „zdecydowana" (identyczne zachowanie do dzisiejszego `handleCorrectSuccess`). Stary endpoint `POST /api/detections/[id]/correct` obsługuje już wyłącznie `manual_entry`.

## Czego NIE robimy

- Nie zmieniamy trybu `manual_entry` (przycisk „Wpisz ręcznie", detekcje bez kandydata) — zostaje dokładnie jak dziś, wraz z `CorrectForm`/`CorrectionModal`.
- Nie przenosimy edycji `edited_at`/danych zakupu kandydata przez rematch/refine — te akcje **zastępują** wiersze kandydatów świeżym wyszukiwaniem (tak jak dziś tytuł/autor/ISBN z poprzedniego stanu też nie przetrwają rematch/refine); to spójne z istniejącym zachowaniem, nie regres.
- Nie dodajemy w modalu ostrzeżenia przy zamknięciu (X/Anuluj) z niezapisanymi zmianami — tylko „Zatwierdź" ma dirty-check. Zamknięcie/Anuluj zawsze cicho odrzuca niezapisane zmiany (jak dziś w add/edit mode).
- Nie zmieniamy `RematchForm` (Szukaj po tytule na karcie detekcji) — to osobna, równoległa ścieżka do zastąpienia kandydata wynikiem świeżego wyszukiwania, poza zakresem tej zmiany.
- Nie dotykamy `enrich-covers.ts` (dociąganie okładek w tle) — działa na `cover_url` per detekcja, niezależnie od `edited_at`.

## Krytyczne szczegóły implementacji

- **Kolejność Zatwierdź z niezapisanymi zmianami**: modal musi trzymać snapshot ostatnio zapisanego stanu (ustawiony przy montowaniu z `book` prop i po każdym udanym „Zapisz"). Klik „Zatwierdź" porównuje bieżące pola z tym snapshotem — różnica → `ConfirmDialog` („Masz niezapisane zmiany. Zapisać i zatwierdzić?"); potwierdzenie woła zapis, a DOPIERO po jego sukcesie woła `/confirm` (sekwencyjnie, nie równolegle — błąd zapisu nie powinien prowadzić do zatwierdzenia nieaktualnych danych).
- **`confirm-batch.ts` musi dostać identyczne traktowanie co `confirm.ts`** (SELECT `edited_at`+pola zakupu, fallback kandydat??photo, `correctionType` z `edited_at`) — to trzecia, niezależna kopia tej samej logiki w kodzie; pominięcie jej zostawi niespójność między pojedynczym a masowym zatwierdzaniem.

## Faza 1: Migracja + endpoint kandydata + telemetria

### Przegląd

Rozszerzamy `book_candidates` o `edited_at` + pola zakupu, uogólniamy endpoint PATCH okładki na pełną edycję kandydata, i uczymy `confirm.ts`/`confirm-batch.ts` rozróżniać „zaakceptowano bez zmian" od „zaakceptowano po edycji". Zwężamy stary `/correct` do samego `manual_entry`.

### Wymagane zmiany:

#### 1. Migracja `book_candidates`

**Plik**: `supabase/migrations/0029_candidate_full_edit.sql` (nowy)

**Cel**: Dodaje `edited_at timestamptz null` (znacznik „ten kandydat był ręcznie edytowany przed zatwierdzeniem" — czytany przez `confirm.ts`/`confirm-batch.ts` do wyboru `correction_type`) oraz `purchase_date date`, `purchase_price numeric(10,2)`, `purchase_city text`, `purchase_event text` (override danych zakupu per-kandydat, zamiast dzielonych `photos.purchase_*`).

**Kontrakt**: 5 nowych nullable kolumn na `book_candidates`, bez zmian RLS (istniejąca blankietowa `book_candidates_update_own` już pokrywa nowe kolumny).

#### 2. `UpdateCandidateSchema` — uogólnienie Zod schema

**Plik**: `src/lib/books/schema.ts`

**Cel**: Zastępuje `UpdateCandidateCoverSchema` (tylko `cover_url`) nowym `UpdateCandidateSchema` obejmującym wszystkie edytowalne pola kandydata. Wzorzec identyczny do `UpdateBookSchema` (wszystkie pola opcjonalne, `null` = wyczyść, `.strict()`, `.refine` wymagający ≥1 pola poza `candidate_id`).

**Kontrakt**: `candidate_id: z.uuid()` (wymagane) + opcjonalne `title` (min 1 znak, max 300), `authors` (`string[]`, bez wymogu min-length — pozwala wyczyścić), `publisher` (nullable), `published_year` (nullable, 1000–2100), `isbn_13` (regex 13 cyfr, nullable), `isbn_10` (regex 9 cyfr+`[\dX]`, nullable), `cover_url` (URL, nullable), `purchase_date` (regex `YYYY-MM-DD`, nullable), `purchase_price` (0–99999.99, nullable), `purchase_city` (nullable), `purchase_event` (nullable). Usuń `UpdateCandidateCoverSchema` i jego eksportowany typ (zastąpione).

#### 3. `CorrectDetectionSchema` — zwężenie do `manual_entry`

**Plik**: `src/lib/books/schema.ts`

**Cel**: Wariant `field_edit` znika (zastąpiony przez `UpdateCandidateSchema` + istniejący `ConfirmDetectionSchema`). Zostaje tylko `manual_entry`.

**Kontrakt**: `CorrectDetectionSchema` przestaje być `z.discriminatedUnion` (jeden wariant nie ma sensu jako unia) — staje się zwykłym `z.object({ mode: z.literal('manual_entry'), ...CorrectedFieldsShape, isbn_13, isbn_10 })`. Typ `CorrectDetectionInput` podąża za wywnioskowanym typem.

#### 4. Endpoint `cover.ts` → `candidate.ts` (rename + rozszerzenie)

**Plik**: `src/pages/api/detections/[id]/candidate.ts` (przeniesiony z `cover.ts`, `git mv` żeby zachować historię)

**Cel**: PATCH przyjmuje teraz dowolny podzbiór edytowalnych pól kandydata (nie tylko okładkę), zapisuje je razem z `edited_at = now()` (zawsze, niezależnie które pola przyszły — to jest sygnał „ktoś tu grzebał", nie licznik zmian).

**Kontrakt**: Ten sam wzorzec co dzisiejszy `cover.ts` (401/404 detection, 400 walidacja, 404 candidate not found w tym detection_id, 500 DB error, 200 z echem zapisanych pól) — `UPDATE ... SET <pola z payloadu>, edited_at = now() WHERE id = candidate_id AND detection_id = detectionId RETURNING <wszystkie edytowalne pola>`. Response `{ data: { candidate_id, title, authors, isbn_13, isbn_10, publisher, published_year, cover_url, purchase_date, purchase_price, purchase_city, purchase_event } }`.

#### 5. `confirm.ts` — telemetria + fallback zakupu

**Plik**: `src/pages/api/detections/[id]/confirm.ts`

**Cel**: SELECT kandydata rozszerzony o `edited_at, purchase_date, purchase_price, purchase_city, purchase_event`. `correctionType` wybierany dynamicznie (`candidate.edited_at ? 'field_edit' : 'accept'`), `correctedFields` wypełniane bieżącymi `candidate.title`/`candidate.authors` gdy `edited_at` ustawione (bez porównania do wartości sprzed edycji — ta straciła się przy PATCH w miejscu; to świadomy kompromis telemetryczny). `purchase_date/city/event` z fallbackiem `candidate.<pole> ?? photo.<pole> ?? null`; `purchase_price` bez fallbacku do photo (kolumna nie istnieje na `photos`) — `candidate.purchase_price ?? null`.

**Kontrakt**: `ConfirmDetectionArgs['book']` (`ConfirmBookInput` w `confirm.ts` lib) zyskuje pole `purchase_price: number | null`; `INSERT books` w `confirmDetectionToCatalog` dopisuje `purchase_price: book.purchase_price`.

#### 6. `confirm-batch.ts` — identyczne traktowanie

**Plik**: `src/pages/api/photos/[id]/confirm-batch.ts`

**Cel**: Ta sama zmiana co w punkcie 5, zastosowana do drugiej, niezależnej kopii logiki budowania `book` z kandydata (SELECT + fallback + `correctionType` dynamiczny zamiast twardego `'accept'`).

**Kontrakt**: SELECT `book_candidates` rozszerzony o te same 5 kolumn; pętla per-item buduje `book`/`correctionType`/`correctedFields` identycznie jak w `confirm.ts`.

#### 7. `correct.ts` — usunięcie wariantu `field_edit`

**Plik**: `src/pages/api/detections/[id]/correct.ts`

**Cel**: Endpoint obsługuje już tylko `manual_entry` — gałąź `if (input.mode === 'field_edit') {...}` (pobranie kandydata, `correctionType = 'field_edit'`) znika całkowicie; zostaje ciało dzisiejszej gałęzi `else` (manual_entry) jako jedyna ścieżka.

**Kontrakt**: Sygnatura odpowiedzi bez zmian (`{ data: { book_id, shelf_id } }`), ale request musi mieć `mode: 'manual_entry'` (jedyna dopuszczalna wartość po zwężeniu schema). Gałąź `manual_entry` buduje własny `bookInput: ConfirmBookInput` — dopisz `purchase_price: null` (typ `ConfirmBookInput` z punktu 5 wymaga tego pola; manual_entry nie ma kandydata, więc zawsze `null`).

### Kryteria sukcesu:

#### Automatyczne:

- `npx supabase migration up` (lokalny stack) aplikuje `0029` czysto
- `npm run test` — nowe testy jednostkowe (patrz Faza 4) + cała suita zielone
- `npm run lint && astro check && npm run build` czysto

#### Ręczne:

- Brak — czysto backendowa faza, weryfikacja pokryta automatami + manualnym testem end-to-end na końcu Fazy 3/4.

---

## Faza 2: `BookModal` — propose w pełni edytowalny, trzy akcje

### Przegląd

`BookModal mode="propose"` przestaje być read-only-z-wyjątkiem-okładki — staje się w pełni edytowalny jak `edit`, ale z własnym zestawem akcji (Zapisz / Zatwierdź / Anuluj) zamiast jednego „Zapisz" z add/edit.

### Wymagane zmiany:

#### 1. `canEdit` i widoczność sekcji

**Plik**: `src/components/BookModal.tsx`

**Cel**: `BookFields` w propose przestaje być `readOnly` — pola tytuł/autorzy/wydawca/rok/ISBN edytowalne identycznie jak w edit. `SearchPanel` i `PurchaseSection` renderowane też w propose (dziś ukryte za `canEdit`).

**Kontrakt**: `canEdit` (dziś `mode !== 'propose'`) przestaje sterować widocznością `BookFields readOnly`/`SearchPanel`/`PurchaseSection` — te trzy elementy widoczne we wszystkich trybach. Stopka (przyciski akcji) zostaje **osobno warunkowana per-mode** (patrz punkt 3) zamiast wspólnego `canEdit &&`.

#### 2. Scalenie zapisu okładki z resztą pól — jedno „Zapisz"

**Plik**: `src/components/BookModal.tsx`

**Cel**: `handleSaveCandidateCover` (z `candidate-cover-override`, PATCH tylko `cover_url`) rozszerza się na `handleSaveCandidate` — PATCH-uje WSZYSTKIE bieżące pola formularza (tytuł, autorzy, wydawca, rok, ISBN-10/13, `resolveCoverStrict(...)` dla okładki, dane zakupu) na raz do `/api/detections/[id]/candidate`. Po sukcesie aktualizuje lokalny snapshot „ostatnio zapisane" (do dirty-checku Zatwierdź, patrz punkt 4) i woła `onCandidateSaved` z pełnym patchem.

**Kontrakt**: `onCoverSaved?: (patch: { coverUrl: string | null }) => void` → zastąp `onCandidateSaved?: (patch: CandidatePatch) => void`, gdzie `CandidatePatch` niesie wszystkie pola, które PATCH faktycznie wysłał (title, authors, publisher, publishedYear, isbn13, isbn10, coverUrl, purchaseDate, purchasePrice, purchaseCity, purchaseEvent). Usuń dedykowany przycisk „Zapisz okładkę" (`propose-cover-save` itd.) — okładka zapisuje się razem z resztą przez wspólny przycisk (punkt 3).

#### 3. Stopka propose — Zapisz / Zatwierdź / Anuluj

**Plik**: `src/components/BookModal.tsx`

**Cel**: Nowy blok stopki dla `mode === 'propose'` (równoległy do dzisiejszego `canEdit && (...)` bloku add/edit): trzy przyciski. „Anuluj" = `onClose` (bez zapisu). „Zapisz" = `handleSaveCandidate` (disabled gdy `busy || !fields.title.trim()`, jak dziś w add/edit). „Zatwierdź" = nowy `handleConfirmCandidate` z dirty-checkiem (patrz punkt 4).

**Kontrakt**: `data-testid`: `propose-save`, `propose-confirm`, `propose-cancel` (lub reużycie istniejących `book-modal-save`/`book-modal-cancel` dla Zapisz/Anuluj, żeby zminimalizować zmiany w testach nieswiązanych z propose — patrz Faza 4 dla decyzji, które id zostają).

#### 4. `handleConfirmCandidate` — dirty-check + `ConfirmDialog`

**Plik**: `src/components/BookModal.tsx`

**Cel**: Klik „Zatwierdź": porównaj bieżący stan formularza (fields + cover sloty + purchase) ze snapshotem ostatnio zapisanego stanu. Różny → otwórz `ConfirmDialog` („Masz niezapisane zmiany. Zapisać i zatwierdzić?", potwierdź=„Zapisz i zatwierdź", anuluj=„Anuluj"). Potwierdzenie: `await handleSaveCandidate()` → jeśli sukces, `POST /api/detections/[id]/confirm` z `candidate_id: book.id` → sukces woła `onConfirmed?.()` i `onClose()`. Anuluj w dialogu: zamyka dialog, zostaje w modalu, zero akcji. Bez różnic (nie dirty): od razu `/confirm`, pomijając zapis.

**Kontrakt**: Nowy prop `onConfirmed?: () => void` (wołany po udanym `/confirm`, analogicznie do `onSaved` w add/edit — ale semantycznie różny: „zatwierdzono do katalogu", nie „zapisano metadane"). Reużyj istniejący komponent `ConfirmDialog` (ten sam co w `BookCard.tsx` dla usuwania/przenoszenia) zamiast pisać nowy dialog od zera.

### Kryteria sukcesu:

#### Automatyczne:

- `npm run lint && astro check && npm run build` czysto
- Nowe/zmienione testy jednostkowe `BookModal.test.tsx` (patrz Faza 4) zielone

#### Ręczne:

- Otwórz podgląd kandydata z istniejącym tytułem/ISBN → wszystkie pola edytowalne, „Wyszukaj po danych" widoczny, sekcja zakupu widoczna
- Zmień tytuł + ISBN → „Zapisz" → potwierdzenie widoczne, modal zostaje otwarty z zapisanymi wartościami
- Bez zapisywania zmień pole → „Zatwierdź" → pojawia się dialog „niezapisane zmiany" → Anuluj zostawia w modalu bez zmian w DB
- Ten sam scenariusz → potwierdź w dialogu → zapisuje i zatwierdza, karta pod spodem przechodzi w stan „zdecydowana"

---

## Faza 3: Wiring w `DetectionReview.tsx` (Karty/Lista/Kafelki)

### Przegląd

„Popraw" we wszystkich trzech widokach otwiera ten sam ujednolicony modal z Fazy 2 zamiast `CorrectForm mode="field_edit"`. Lista dostaje nowe wejście (dziś go nie ma). `candidateToDetail()` + DTO rozszerzone o pola zakupu.

### Wymagane zmiany:

#### 1. `BookCandidateDTOSchema` + `GET /api/photos/[id]` — pola zakupu

**Plik**: `src/lib/books/schema.ts`

**Cel**: `BookCandidateDTOSchema` zyskuje `purchaseDate`, `purchasePrice`, `purchaseCity`, `purchaseEvent` (nullable), żeby modal miał czym prefillować `PurchaseSection`.

**Plik**: `src/pages/api/photos/[id].ts`

**Cel**: SELECT `book_candidates` (linia ~197) rozszerzony o `purchase_date, purchase_price, purchase_city, purchase_event`; mapowanie do DTO (linia ~239) dopisuje te 4 pola (camelCase).

#### 2. `candidateToDetail()` — przekazanie pól zakupu

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: Funkcja (dziś zwraca `id, detectionId, title, authors, coverUrl, isbn13, isbn10, publisher, publishedYear, source, matchScore`) dopisuje `purchase_date/purchase_price/purchase_city/purchase_event` z `BookCandidateDTO`.

#### 3. Karty (`DetectionCard`) — usunięcie inline `field_edit`

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: Przycisk „Popraw" (`top &&`, dziś `onClick={() => setShowCorrectForm(true)}`) przełącza na `onClick={() => setShowCandidateDetail(true)}` (ten sam stan, co klik w okładkę). Blok `{top && showCorrectForm && <CorrectForm mode="field_edit" .../>}` usunięty całkowicie (stał się nieosiągalny). Gałąź `{!top && showCorrectForm && <CorrectForm .../>}` (manual_entry) **zostaje bez zmian**. `BookModal mode="propose"` (już istniejący w tym widoku) dostaje `onCandidateSaved` (zamiast `onCoverSaved`, merge pełnego patcha do `detection.candidates`) i `onConfirmed` (woła to samo co dzisiejszy `handleCorrectSuccess`/`onDecided(detection.id,'confirmed')`).

#### 4. Kafelki (`DetectionTile`) — scalenie dwóch ścieżek w jedną

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: Przycisk „Popraw" (`top &&`, dziś `onClick={() => setShowModal(true)}` → `DetectionCorrectionModal` → `CorrectForm field_edit`) przełącza na `onClick={() => setShowCandidateDetail(true)}` — ta sama instancja `BookModal mode="propose"`, co dzisiejszy klik w okładkę. `showModal`/`DetectionCorrectionModal` zostaje wyłącznie dla gałęzi `!top` („Wpisz ręcznie"). `BookModal` (już istniejący w tym widoku) dostaje `onCandidateSaved`/`onConfirmed` analogicznie do Kart.

#### 5. Lista (`DetectionRow`) — nowe wejście do modala

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: Dodaj stan `showCandidateDetail` (dziś nieobecny w tym komponencie). Przycisk „Popraw" (`top &&`, dziś `onClick={() => setShowModal(true)}`) przełącza na `onClick={() => setShowCandidateDetail(true)}`. Renderuj `{showCandidateDetail && activeCandidate && <BookModal mode="propose" book={candidateToDetail(activeCandidate, detection.id)} onCandidateSaved={...} onConfirmed={...} onClose={() => setShowCandidateDetail(false)} />}` (nowy blok, wzorowany 1:1 na analogicznym w Kartach/Kafelkach). `showModal`/`DetectionCorrectionModal` zostaje wyłącznie dla `!top`.

#### 6. `DetectionCorrectionModal` — uproszczenie do samego `manual_entry`

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: Skoro Lista i Kafelki nie wołają już tego komponentu dla `hasMatch` (patrz punkty 4-5), gałąź `field_edit`/`hasMatch` jest martwa — usuń warunek, zostaw tylko render `CorrectForm mode="manual_entry"`. Props `activeCandidate`/`activeCandidateId` (potrzebne tylko dla usuniętej gałęzi field_edit) — usuń z sygnatury.

### Kryteria sukcesu:

#### Automatyczne:

- `npm run lint && astro check && npm run build` czysto

#### Ręczne:

- Karty: „Popraw" na detekcji z kandydatem otwiera pełny edytowalny modal (nie stary formularz pól)
- Lista: „Popraw" na detekcji z kandydatem otwiera ten sam modal (nowe zachowanie — dziś nie istniało)
- Kafelki: „Popraw" i klik w okładkę prowadzą do TEJ SAMEJ instancji modala
- We wszystkich trzech widokach: „Wpisz ręcznie" (detekcja bez kandydata) działa dokładnie jak dziś, bez zmian

---

## Faza 4: Testy

### Wymagane zmiany:

#### 1. Testy jednostkowe — endpointy

**Plik**: `tests/unit/pages/api/detections/candidate.test.ts` (przeniesiony z `cover.test.ts`, rozszerzony o title/authors/isbn/publisher/year/purchase_*, `edited_at` zawsze ustawiane po PATCH)
**Plik**: `tests/unit/pages/api/detections/id.test.ts` (rozszerzenie `confirm` — `correctionType` z `edited_at`, fallback zakupu kandydat??photo, `purchase_price` passthrough; zwężenie `correct` — usunięcie describe-bloku `field_edit`, zostaje tylko `manual_entry`)
**Plik**: `tests/unit/pages/api/photos/confirm-batch.test.ts` (rozszerzenie analogiczne do `confirm.test.ts` — `correctionType`/fallback zakupu dla bulk-accept edytowanego kandydata)
**Plik**: `tests/unit/lib/books/schema.test.ts` (usunięcie testów `CorrectDetectionSchema — field_edit`; nowe testy `UpdateCandidateSchema` obejmujące pełny zestaw pól)

#### 2. Testy jednostkowe — komponenty

**Plik**: `tests/unit/components/BookModal.test.tsx` (usuń/przepisz istniejące 6 testów `propose-cover-*` z `candidate-cover-override` — asserty na dosłowny URL `/cover` i testidy `propose-cover-save`/`propose-cover-url-input`/`propose-cover-saved`/`propose-cover-error`/`propose-cover-source-url`/`propose-cover-section` nie mają już zastosowania po scaleniu zapisu okładki z resztą pól. Napisz w to miejsce testy nowego describe-bloku propose: pola edytowalne nie readOnly, `SearchPanel`/`PurchaseSection` widoczne, jedno „Zapisz" PATCH-uje wszystkie pola + `onCandidateSaved` z pełnym patchem, „Zatwierdź" bez zmian woła `/confirm` wprost, „Zatwierdź" ze zmianami pokazuje `ConfirmDialog`, potwierdzenie w dialogu zapisuje-i-zatwierdza sekwencyjnie, anulowanie w dialogu nie woła żadnego endpointu)
**Plik**: `tests/unit/components/DetectionReview.test.tsx` (usunięcie/przepisanie testów referencujących `CorrectForm mode="field_edit"` w kontekście Karty/Lista/Kafelki na nowy flow modala; testy `manual_entry` bez zmian)

#### 3. E2E

**Plik**: `tests/e2e/proposal-accept-to-catalog.spec.ts` (przepisanie testu „correct (field_edit) — formularz otwiera się" na nowy flow: klik „Popraw" → modal z edytowalnymi polami → zmień tytuł/ISBN → „Zapisz" → potwierdzenie → „Zatwierdź" → karta „zdecydowana"; dodanie wariantu z dirty-check dialogiem; zaktualizuj 2 istniejące mocki `page.route('.../cover', ...)` z `candidate-cover-override` → `/candidate` w tym samym pliku, niezwiązane z testem field_edit)

### Kryteria sukcesu:

#### Automatyczne:

- `npm run test` — nowe + cała suita zielone
- `npx playwright test` — nowy/zmieniony scenariusz zielony, brak nowych flaków
- `npm run lint && astro check && npm run build` czysto

#### Ręczne:

- Pełny cykl na realnej detekcji z produkcji/lokalnego stacku: „Popraw" → edycja wszystkich pól (w tym ISBN i danych zakupu) → „Zapisz" → „Zatwierdź" → potwierdzona książka w `/library` ma wszystkie edytowane wartości, włącznie z ceną/miastem/wydarzeniem zakupu
- Historia korekt (`CorrectionHistoryPanel`) pokazuje `field_edit` dla detekcji edytowanej-przed-zatwierdzeniem tym flow

## Referencje

- Poprzednia zmiana (podstawa tej): `context/archive/2026-07-13-candidate-cover-override/plan.md`
- `src/lib/books/confirm.ts` — jedna ścieżka detekcja→katalog, czyta świeże dane kandydata
- `src/components/PurchaseSection.tsx` — reużywany komponent, zero zmian potrzebnych

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dołącz ` — <commit sha>` po zakończeniu kroku.

### Faza 1: Migracja + endpoint kandydata + telemetria

#### Automatyczne

- [x] 1.1 `npx supabase migration up` aplikuje `0029` czysto — 28408f1
- [x] 1.2 `npm run lint && astro check && npm run build` czysto — 28408f1

### Faza 2: BookModal — propose w pełni edytowalny, trzy akcje

#### Automatyczne

- [x] 2.1 `npm run lint && astro check && npm run build` czysto — ca1b8f2

#### Ręczne

- [x] 2.2 Podgląd kandydata — wszystkie pola edytowalne, Wyszukaj po danych + sekcja zakupu widoczne — ca1b8f2
- [x] 2.3 Zmiana tytułu+ISBN → Zapisz → potwierdzenie, modal zostaje otwarty z zapisanymi wartościami — ca1b8f2
- [x] 2.4 Niezapisana zmiana → Zatwierdź → dialog niezapisanych zmian → Anuluj zostawia bez zmian w DB — ca1b8f2
- [x] 2.5 Ten sam scenariusz → potwierdź w dialogu → zapisuje i zatwierdza, karta „zdecydowana" — retest po Fazie 3 potwierdzony przez usera — 74db050

### Faza 3: Wiring w DetectionReview.tsx (Karty/Lista/Kafelki)

#### Automatyczne

- [x] 3.1 `npm run lint && astro check && npm run build` czysto — 74db050

#### Ręczne

- [x] 3.2 Karty: Popraw otwiera pełny edytowalny modal — 74db050
- [x] 3.3 Lista: Popraw otwiera modal (nowe zachowanie) — 74db050
- [x] 3.4 Kafelki: Popraw i klik w okładkę prowadzą do tej samej instancji modala — 74db050
- [x] 3.5 We wszystkich trzech widokach: Wpisz ręcznie działa bez zmian — 74db050

### Faza 4: Testy

#### Automatyczne

- [x] 4.1 `npm run test` — nowe + cała suita zielone — 4915f0e
- [x] 4.2 `npx playwright test` — nowy scenariusz zielony, brak nowych flaków — 4915f0e
- [x] 4.3 `npm run lint && astro check && npm run build` czysto — 4915f0e

#### Ręczne

- [x] 4.4 Pełny cykl na realnej detekcji — Popraw → edycja wszystkich pól + zakupu → Zapisz → Zatwierdź → książka w /library ma wszystkie wartości — 4915f0e
- [x] 4.5 Historia korekt pokazuje field_edit dla detekcji edytowanej tym flow — 4915f0e
