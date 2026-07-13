# Weak-match AI-resolution gate + historia korekt OCR — Plan implementacji

## Przegląd

Dwie powiązane naprawy odkryte przy manualnej analizie zdjęcia (2026-07-13):

1. **Bramka „Rozwiąż przez AI" jest zbyt wąska.** Dziś widoczna wyłącznie, gdy `book_candidates.length === 0`. Biblioteka Narodowa (keyword/full-text search bez twardego progu trafności) potrafi zwrócić do 5 kompletnie niezwiązanych kandydatów dla niemal dowolnego zapytania (zmierzone: detekcja z tytułem „Podróż życia siostry Shergill" dostała kandydatów typu „Metrologia elektryczna", „Chemia 8" — wszystkie ze score 0.267–0.379, głęboko poniżej `MATCH_MID=0.55`). `detections.status` ustawia się na `'matched'` mimo że żaden kandydat nie jest wiarygodny, a przycisk AI-resolution się nie pojawia, bo `candidates.length > 0`.
2. **Historia oryginalnego odczytu OCR ginie bezpowrotnie.** `rematch.ts` i `refine.ts` nadpisują `detections.raw_title`/`raw_author` w miejscu (`UPDATE ... SET raw_title=?`), bez żadnego logu. `correct.ts` (przez `confirmDetectionToCatalog`) robi to poprawnie — zostawia `detections.raw_title` nietknięte i loguje `corrections.original_raw_title` osobno. `rematch`/`refine` nie mają tego zabezpieczenia: po jednym kliknięciu „Doprecyzuj odczyt" lub „Szukaj po tytule" oryginalny odczyt vision jest nieodwracalnie utracony, a user nie ma jak zweryfikować co system faktycznie zobaczył na grzbiecie.

## Analiza stanu obecnego

### Kluczowe odkrycia:

- `DetectionReview.tsx:1365,1747,2081` — trzy identyczne bloki `{!top && (<AiResolutionButton .../>)}` (Karty/Lista/Kafelki), gdzie `top = detection.candidates[0] ?? null`. To jedyne miejsce sterujące widocznością przycisku.
- `src/lib/matching/score.ts:5` — `MATCH_MID = 0.55` już wyeksportowany; `DetectionReview.tsx` ma lokalną kopię `const MATCH_MID = 0.55;` (linia ~18) używaną do `getMatchTier()` — ten sam próg, żadnego nowego importu.
- `src/pages/api/detections/[id]/rematch.ts:158-161` — `.update({ raw_title: resolvedTitle, raw_author: rawAuthor, status: finalStatus })` nadpisuje bez logowania poprzedniej wartości.
- `src/pages/api/detections/[id]/refine.ts:333-342` — analogiczne `.update({ raw_title: refinedTitle, raw_author: refinedAuthor, ... })`, też bez logu (poza gałęzią `parse_failure`, która loguje `original_raw_title` ale nie dochodzi do samego `UPDATE`).
- `src/lib/books/confirm.ts:182-197` (`confirmDetectionToCatalog`) — wzorzec do naśladowania: `supabase.from('corrections').insert({ user_id, detection_id, original_raw_title, corrected_title, corrected_authors, correction_type })`, błąd logowany ale nieblokujący.
- `src/pages/api/detections/[id]/resolve.ts` — NIE nadpisuje `raw_title`/`raw_author` (mój wcześniejszy slice S-50); gałąź `found` już bezwarunkowo `DELETE FROM book_candidates WHERE detection_id=?` przed insertem nowego kandydata — działa poprawnie także dla przypadku „słabe-ale-niepuste" kandydaci, zero zmian potrzebnych w tym endpoincie.
- `corrections.correction_type` CHECK (migracja 0027, najnowsza): `'title_typo', 'wrong_author', 'wrong_book', 'not_a_book', 'parse_failure', 'accept', 'reject', 'field_edit', 'manual_entry', 'ai_resolution_not_found'` — brak wartości dla „nadpisanie przez rematch/refine".
- **[plan-review F1]** `corrections` NIE MA kolumny na oryginalnego autora — istniejące kolumny to `original_raw_title`, `corrected_title`, `corrected_authors` (nowa wartość). Bez nowej kolumny historia autora nadal ginie po rematch/refine — dokładnie ten sam przypadek, który zainicjował tę zmianę („Marowska Duchowska" → prawdziwy autor), nie zostałby naprawiony. Dodatkowo `rematch.ts:76` robi `.select('id, status, raw_title')` — NIE pobiera `raw_author` przed nadpisaniem, więc dziś nie ma nawet z czego by go zalogować.
- `corrections` ma już RLS SELECT policy (`corrections_select_own`, migracja 0002) i jest w pełni otypowana w `database.types.ts` (`correction_type: string | null`, brak literal union) dla ISTNIEJĄCYCH kolumn — GET endpoint może użyć zwykłego typowanego klienta dla nich. Nowa kolumna `original_raw_author` (Faza 1) będzie chwilowo poza committowanym `database.types.ts` do czasu regeneracji — insert/select tego pola przez `(locals.supabase as any)` + defensywny retry na `42703`/`PGRST204`, dokładnie wzorzec z S-50 (`account/stats.ts::selectCosts()`, `photos/[id]/costs.ts`).
- `CostPanel.tsx` + jego użycie w `DetectionReview.tsx:1079-1094` (jedyne miejsce, tylko widok Karty) — wzorzec lazy-fetch popover do naśladowania dla nowego panelu historii, ale rozszerzony na wszystkie 3 widoki (parytet z `AiResolutionButton`/`RefineButton`, nie z asymetrycznym `CostPanel`).
- Migracja: najwyższy numer na `origin/main` to `0027` → nowa migracja to `0028`.

## Pożądany stan końcowy

- Detekcja, dla której najlepszy kandydat ma `matchScore < MATCH_MID` (niezależnie od tego, ilu kandydatów zwróciła kaskada), pokazuje przycisk „Rozwiąż przez AI" tak samo jak dziś przy `candidates.length === 0`.
- Każde kliknięcie „Szukaj po tytule" (rematch) lub „Doprecyzuj odczyt" (refine) loguje ORYGINALNY `raw_title` **i** `raw_author` do `corrections` PRZED nadpisaniem — nic nie ginie, w tym autor (nie tylko tytuł).
- Na karcie detekcji (wszystkie 3 widoki) dostępny jest mały przycisk „Historia" pokazujący chronologicznie: co było odczytane pierwotnie (tytuł + autor) → na co zostało skorygowane, kiedy i jakim mechanizmem (rematch/refine/field_edit/manual_entry/accept/reject/ai_resolution_not_found).

Weryfikacja: nowe testy jednostkowe (endpoint historii, insert corrections w rematch/refine) i E2E (widoczność przycisku dla słabego matchu, panel historii pokazuje poprawne dane po rematch/refine) zielone; ręczna weryfikacja na tej samej detekcji, która ujawniła problem.

## Czego NIE robimy

- Nie zmieniamy scoringu ani samego BN-owego wyszukiwania (BN nadal będzie zwracać luźne dopasowania — to jest input, nie coś do naprawienia w tym slice'u).
- Nie cofamy/nie edytujemy istniejących, już utraconych historii OCR sprzed tej zmiany (dane z przeszłości pozostają nieodtwarzalne — to fix na przyszłość, nie migracja danych).
- Nie dodajemy możliwości „przywróć oryginalny odczyt" (jednoklikowy rollback) — panel jest wyłącznie READ-ONLY widokiem historii. Przywracanie to osobny, świadomie odłożony temat.
- Nie zmieniamy `detections.status` semantyki (`'matched'` nadal znaczy „ma ≥1 kandydata”, nie „ma dobrego kandydata") — to osobna, głębsza zmiana warta własnego rozważenia, nie robimy jej przy okazji.
- Nie logujemy historii dla `resolve.ts`/`correct.ts` — już działają poprawnie (patrz Analiza).

## Podejście do implementacji

Cztery fazy, rosnąco: schemat → naprawa utraty danych (backend) → rozszerzenie bramki UI → nowa powierzchnia UI (historia) → testy. Implementacja przechodzi przez wszystkie fazy bez zatrzymywania się na ręczną weryfikację pośrodku (konwencja projektu); pełna manualna weryfikacja na końcu.

## Faza 1: Schemat

### Przegląd

Migracja rozszerzająca `corrections.correction_type` o wartości dla nadpisań OCR **oraz** dodająca kolumnę na oryginalnego autora (plan-review F1 — bez niej historia autora nadal ginie).

### Wymagane zmiany:

#### 1. Migracja rozszerzenia CHECK + nowa kolumna

**Plik**: `supabase/migrations/0028_corrections_ocr_overwrite_types.sql`

**Cel**: (a) Dopuszcza `'rematch'` i `'refine'` jako nowe `correction_type`, żeby móc logować nadpisanie `raw_title`/`raw_author` przy tych dwóch akcjach. (b) Dodaje `corrections.original_raw_author text` (nullable) — istniejące kolumny (`original_raw_title`, `corrected_authors`) nie pozwalają zalogować oryginalnego autora sprzed nadpisania.

**Kontrakt**: CHECK — dokładnie wzorzec z `0008_catalog_read_and_telemetry.sql`/`0027_ai_book_resolution_substrate.sql` — dynamiczne wyszukanie nazwy constraintu przez `pg_constraint`/`pg_get_constraintdef` (odporne na auto-nazewnictwo), `drop` + `add constraint corrections_correction_type_check check (correction_type in (..., 'rematch', 'refine'))`. Kolumna: `alter table corrections add column original_raw_author text;` (zwykła addytywna kolumna, nullable — historyczne wiersze dostają `NULL`, zgodne z „Czego NIE robimy": nie migrujemy przeszłych danych).

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- Migracja aplikuje się czysto lokalnie: `supabase migration up` (WSL)
- `npx wrangler types && astro check` przechodzi
- `npm run lint` przechodzi
- `npm run build` przechodzi

---

## Faza 2: Zachowanie historii OCR przy rematch/refine

### Przegląd

`rematch.ts` i `refine.ts` logują oryginalny `raw_title`/`raw_author` do `corrections` PRZED nadpisaniem, dokładnie wzorcem `confirmDetectionToCatalog`.

### Wymagane zmiany:

#### 1. Log w rematch.ts

**Plik**: `src/pages/api/detections/[id]/rematch.ts`

**Cel**: **[plan-review F1]** Rozszerz wstępny `.select('id, status, raw_title')` (linia ~76) o `raw_author`, żeby mieć oryginalną wartość PRZED nadpisaniem (dziś w ogóle niepobierana). Przed `UPDATE detections SET raw_title=..., raw_author=...` (obecnie linie ~158-161), wstaw insert do `corrections` z ORYGINALNYM (przed-update) `detection.raw_title`/`detection.raw_author` jako `original_raw_title`/`original_raw_author`, oraz nowymi wartościami (`resolvedTitle`/`rawAuthor`) jako `corrected_title`/`corrected_authors`.

**Kontrakt**: Select: `.select('id, status, raw_title, raw_author')`. Insert (przez `(locals.supabase as any)` + defensywny retry na `42703`/`PGRST204` bez `original_raw_author` — kolumna z Fazy 1 nie będzie w committowanym `database.types.ts` do czasu regeneracji, wzorzec S-50): `{ user_id: locals.user.id, detection_id: detectionId, original_raw_title: detection.raw_title, original_raw_author: detection.raw_author, corrected_title: resolvedTitle, corrected_authors: rawAuthor ? [rawAuthor] : null, correction_type: 'rematch' }` — błąd logowany przez `console.error`, NIE blokuje ani nie przerywa dalszego flow (ten sam non-blocking styl co `confirmDetectionToCatalog:191-197`). Insert następuje niezależnie od tego, czy `shouldReplace` jest `true` czy `false` (rematch zawsze zmienia `raw_title`/`raw_author` w bazie, niezależnie od tego czy podmienia kandydatów).

#### 2. Log w refine.ts

**Plik**: `src/pages/api/detections/[id]/refine.ts`

**Cel**: Przed `UPDATE detections SET raw_title=..., raw_author=...` (obecnie linie ~333-342), analogiczny insert z `detection.raw_title`/`detection.raw_author` (już pobrane wcześniej w handlerze, linie ~123-129 — `raw_author` już jest w tym select, w przeciwieństwie do `rematch.ts`) jako `original_raw_title`/`original_raw_author`, i `refinedTitle`/`refinedAuthor` jako nowe wartości.

**Kontrakt**: `(locals.supabase as any).from('corrections').insert({ user_id: locals.user.id, detection_id: detection.id, original_raw_title: detection.raw_title, original_raw_author: detection.raw_author, corrected_title: refinedTitle, corrected_authors: refinedAuthor ? [refinedAuthor] : null, correction_type: 'refine' })` — ten sam non-blocking styl + defensywny retry na `42703`/`PGRST204` (jak w rematch.ts). Wstawiane TYLKO w ścieżce sukcesu (`refined.ok === true`, już mamy `refinedTitle`/`refinedAuthor`) — ścieżka `parse_failure` (linia ~225-240) już ma własne, wcześniejsze logowanie do `corrections` (bez `original_raw_author` — nieistotne przy niepowodzeniu parsowania) i kończy się `return` przed dotarciem do `UPDATE`, więc nie wymaga zmian.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run lint`, `astro check` przechodzą
- Nowe testy jednostkowe (Faza 5) dla obu endpointów zielone

---

## Faza 3: Bramka AI-resolution dla słabych dopasowań

### Przegląd

Rozszerzenie warunku widoczności `AiResolutionButton` z „brak kandydatów" na „brak kandydatów LUB najlepszy kandydat poniżej `MATCH_MID`".

### Wymagane zmiany:

#### 1. Rozszerzenie warunku w 3 widokach

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: Zmień `{!top && (<AiResolutionButton .../>)}` na `{(!top || top.matchScore < MATCH_MID) && (<AiResolutionButton .../>)}` w każdym z 3 miejsc (linie ~1365 Karty/lg, ~1747 Lista/md, ~2081 Kafelki/sm). Zero zmian w samym komponencie `AiResolutionButton` ani w `useDetectionDecision`/`handleAiResolve` — logika endpointu już poprawnie usuwa istniejących (słabych) kandydatów w gałęzi `found` (patrz Analiza).

**Kontrakt**: `top` już istnieje w scope każdego z 3 bloków (destrukturyzowane z `useDetectionDecision`). `MATCH_MID` już zdefiniowany lokalnie w pliku (linia ~18) — bez nowego importu.

#### 2. Aktualizacja nieaktualnego komentarza w resolve.ts

**Plik**: `src/pages/api/detections/[id]/resolve.ts`

**Cel**: **[plan-review F2]** Komentarz przy linii ~32 (`shouldReplace jest zawsze true — przycisk jest widoczny wyłącznie gdy candidates.length === 0`) stanie się nieaktualny po tej fazie — kod działania nie zmienia się (delete nadal bezwarunkowy), ale opis niezmiennika trzeba zaktualizować, żeby nie wprowadzał w błąd przyszłego czytelnika.

**Kontrakt**: Zmień opis na coś w rodzaju: „shouldReplace jest zawsze true — przycisk jest widoczny gdy brak kandydatów LUB najlepszy kandydat ma matchScore < MATCH_MID (S-slice weak-match-resolve-and-ocr-audit); w obu przypadkach usunięcie istniejących (0 lub słabych) kandydatów przed insertem jest poprawne."

#### 3. Ostrzeżenie w dialogu potwierdzenia o zastąpieniu istniejących kandydatów

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: **[plan-review F3]** Po rozszerzeniu bramki (punkt 1) przycisk może się pojawić, gdy `top` istnieje (słaby match) — kliknięcie „Rozwiąż przez AI" bezwarunkowo usuwa te widoczne kandydatury (patrz `resolve.ts`, gałąź `found`). Dialog potwierdzenia (3 identyczne bloki `ConfirmDialog` z `title="Rozwiązać przez AI?"`, linie ~1415, ~1794, ~2128) dziś tego nie sygnalizuje — user może stracić coś, co już widział, nie wiedząc o tym.

**Kontrakt**: `message` dialogu warunkowo rozszerzony, gdy `top` istnieje: dopisz zdanie w stylu „Zastąpi obecne (niepewne) propozycje." do istniejącego tekstu „Uruchomi wyszukiwanie w sieci przez AI (Claude web_search) w oparciu o odczytany tytuł/autora. Operacja jest płatna i wymaga aktywnego klucza Anthropic." — np. `` `${baseMessage}${top ? ' Zastąpi obecne (niepewne) propozycje.' : ''}` ``. Ta sama zmiana w każdym z 3 bloków.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run lint`, `astro check` przechodzą
- Istniejący test E2E `ai-book-resolution.spec.ts` scenariusz „widoczny tylko dla detekcji bez kandydatów" nadal zielony PO dostosowaniu (Faza 5) — musi używać kandydata z wysokim `matchScore` (np. 0.9, jak dziś), żeby test dalej weryfikował zamierzone ukrycie
- Nowy scenariusz E2E (Faza 5): detekcja ze słabym kandydatem (`matchScore < MATCH_MID`) pokazuje przycisk

---

## Faza 4: UI — panel historii korekt

### Przegląd

Nowy endpoint zwracający chronologiczną historię `corrections` dla detekcji + lekki komponent popover (wzorzec `CostPanel`) we wszystkich 3 widokach.

### Wymagane zmiany:

#### 1. Endpoint historii

**Plik**: `src/pages/api/detections/[id]/history.ts`

**Cel**: `GET /api/detections/[id]/history` — auth guard, `parseUuidParam`, zwraca listę `corrections` dla tej detekcji posortowaną chronologicznie rosnąco.

**Kontrakt**: Select przez `(locals.supabase as any)` + defensywny retry na `42703` bez `original_raw_author` (kolumna z Fazy 1, patrz Faza 1/2 — do czasu regeneracji `database.types.ts`): `.from('corrections').select('id, correction_type, original_raw_title, original_raw_author, corrected_title, corrected_authors, created_at').eq('detection_id', detectionId).order('created_at', { ascending: true })`. 404 gdy detekcja nie istnieje / nie należy do usera (analogicznie do innych endpointów `detections/[id]/*` — sprawdź istnienie detekcji przez `SELECT id FROM detections WHERE id=?` przez zwykły typowany klient przed odpytaniem `corrections`, RLS + `maybeSingle()` zwraca `null` dla cudzej detekcji). Response: `{ data: { corrections: Array<{id, correction_type, original_raw_title, original_raw_author, corrected_title, corrected_authors, created_at}> } }`.

#### 2. Komponent panelu historii

**Plik**: `src/components/CorrectionHistoryPanel.tsx` (nowy)

**Cel**: Mały przycisk-ikona (zegar/historia) + popover z lazy-fetch, wzorzec identyczny z `CostPanel.tsx` (trigger button, `open`/`data`/`loading`/`error` state, fetch na klik, zamknięcie klikiem poza). Lista wpisów posortowana chronologicznie: `original_raw_title`/`original_raw_author` → `corrected_title`/`corrected_authors`, etykieta `correction_type` (mapa: `rematch`→„Szukaj po tytule", `refine`→„Doprecyzuj odczyt", `field_edit`→„Popraw", `manual_entry`→„Wpis ręczny", `accept`→„Zaakceptowano", `reject`→„Odrzucono", `ai_resolution_not_found`→„AI nie znalazła"), `created_at` sformatowany przez istniejący `formatDate` z `lib/costs/format.ts`. Pusta lista → „Brak historii korekt".

**Kontrakt**: `type Props = { detectionId: string }`. Brak propa `photoId` (w przeciwieństwie do `CostPanel` — historia jest czysto per-detekcja, nie per-zdjęcie).

#### 3. Wiring w 3 widokach

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: Renderuj `<CorrectionHistoryPanel detectionId={detection.id} />` obok istniejącego `CostPanel`/przycisków akcji w każdym z 3 widoków (Karty/Lista/Kafelki) — pełna parytetowość z `AiResolutionButton`/`RefineButton`, nie asymetryczny wzorzec `CostPanel` (dziś tylko Karty).

**Kontrakt**: Import `CorrectionHistoryPanel` na górze pliku; jeden nowy tag JSX w każdym z 3 bloków renderujących przyciski akcji.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run lint`, `astro check` przechodzą
- Nowe testy jednostkowe dla endpointu historii (Faza 5) zielone

---

## Faza 5: Testy

### Przegląd

Vitest dla endpointu historii i insertów corrections w rematch/refine (mock Supabase); Playwright dla widoczności przycisku i panelu historii.

### Wymagane zmiany:

#### 1. Testy jednostkowe

**Plik**: `tests/unit/pages/api/detections/history.test.ts`

**Cel**: `GET /api/detections/[id]/history` — zwraca posortowaną listę, 401 bez usera, 404 dla nieistniejącej/cudzej detekcji, pusta lista gdy brak korekt.

**Plik**: `tests/unit/pages/api/detections/rematch.test.ts` (rozszerzenie jeśli istnieje, inaczej nowy)

**Cel**: Rematch wstawia `corrections` z `correction_type: 'rematch'` i poprawnymi `original_raw_title`/`original_raw_author` PRZED update; błąd insertu nie blokuje głównej odpowiedzi.

**Plik**: `tests/unit/pages/api/detections/refine.test.ts` (rozszerzenie jeśli istnieje, inaczej nowy)

**Cel**: Refine wstawia `corrections` z `correction_type: 'refine'` i poprawnymi `original_raw_title`/`original_raw_author` w ścieżce sukcesu; ścieżka `parse_failure` niezmieniona (już loguje, bez `original_raw_author`).

#### 2. E2E

**Plik**: `tests/e2e/ai-book-resolution.spec.ts` (rozszerzenie istniejącego)

**Cel**: Dostosuj scenariusz „widoczny tylko dla detekcji bez kandydatów" (upewnij się, że istniejący kandydat ma `matchScore: 0.9`, jawnie skomentowane dlaczego). Dodaj nowy scenariusz: detekcja z jednym kandydatem `matchScore < 0.55` → przycisk „Rozwiąż przez AI" widoczny **i** dialog potwierdzenia zawiera zdanie o zastąpieniu obecnych propozycji (plan-review F3) — dla kontrastu dodaj asercję, że dla detekcji BEZ kandydatów (`!top`) tego zdania NIE ma.

**Plik**: `tests/e2e/correction-history.spec.ts` (nowy)

**Cel**: Mock `GET /api/detections/*/history` z przykładowymi wpisami → otwarcie panelu pokazuje poprawne dane w poprawnej kolejności; pusta lista → „Brak historii korekt".

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run test:unit` — nowe + cała suita zielone
- `npm run test:e2e` — nowe specy zielone, brak nowych flaków
- `npm run lint && astro check && npm run build` — czysto

#### Weryfikacja ręczna:

- Na detekcji #16/#19/#20 (zdjęcie z manualnej analizy) — przycisk „Rozwiąż przez AI" teraz widoczny mimo istniejących słabych kandydatów
- Kliknięcie „Szukaj po tytule" lub „Doprecyzuj odczyt" na dowolnej detekcji → panel historii pokazuje oryginalny odczyt i nową wartość
- Panel historii dla świeżej detekcji (bez korekt) pokazuje „Brak historii korekt"

---

## Strategia testowania

### Testy jednostkowe:

- Endpoint historii: sortowanie, 401/404, pusta lista
- `rematch.ts`/`refine.ts`: insert `corrections` przed update, non-blocking na błąd

### Testy integracyjne / E2E:

- Widoczność przycisku AI-resolution dla słabego (ale niepustego) matchu
- Panel historii — mock danych, poprawne renderowanie chronologiczne

### Kroki testowania ręcznego:

1. Otwórz zdjęcie z detekcjami #16/#19/#20 (opisane w analizie) → sprawdź, że „Rozwiąż przez AI" jest teraz widoczny
2. Kliknij „Szukaj po tytule" na dowolnej detekcji, zmień tytuł i autora → sprawdź w Supabase Studio nowy wiersz `corrections` z `correction_type='rematch'` i poprawnymi `original_raw_title`/`original_raw_author`
3. Otwórz panel historii tej samej detekcji w UI → sprawdź czy wpis się zgadza z tym, co w bazie

## Uwagi dotyczące migracji

Migracja czysto addytywna (rozszerzony CHECK) — brak ryzyka dla istniejących danych. Deploy przez istniejący `deploy.yml` migrate-first krok.

## Referencje

- Wzorzec logowania korekt: `src/lib/books/confirm.ts:182-197` (`confirmDetectionToCatalog`)
- Wzorzec popover lazy-fetch: `src/components/CostPanel.tsx` + użycie w `DetectionReview.tsx:1079-1094`
- Wzorzec rozszerzenia CHECK: `supabase/migrations/0008_catalog_read_and_telemetry.sql`, `0027_ai_book_resolution_substrate.sql`
- Endpointy dotknięte: `src/pages/api/detections/[id]/rematch.ts`, `src/pages/api/detections/[id]/refine.ts`
- Warunek bramki: `src/components/DetectionReview.tsx:1365,1747,2081`
- Analiza źródłowa (rozmowa 2026-07-13): zdjęcie `f07dad97-62b1-4a02-a87e-75fa6433a25e`, detekcje #16/#19/#20

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dołącz ` — <commit sha>` po zakończeniu kroku.

### Faza 1: Schemat

#### Automatyczne

- [x] 1.1 Migracja aplikuje się czysto lokalnie — d96f9c6
- [x] 1.2 `npx wrangler types && astro check` przechodzi — d96f9c6
- [x] 1.3 `npm run lint` przechodzi — d96f9c6
- [x] 1.4 `npm run build` przechodzi — d96f9c6

### Faza 2: Zachowanie historii OCR przy rematch/refine

#### Automatyczne

- [x] 2.1 `npm run lint`, `astro check` przechodzą — deecdcd
- [ ] 2.2 Nowe testy jednostkowe dla obu endpointów zielone (dedykowane asercje — Faza 5)

### Faza 3: Bramka AI-resolution dla słabych dopasowań

#### Automatyczne

- [x] 3.1 `npm run lint`, `astro check` przechodzą — 6d71a0f
- [ ] 3.2 Istniejący E2E scenariusz (dostosowany) nadal zielony (Faza 5)
- [ ] 3.3 Nowy E2E scenariusz (słaby kandydat → przycisk widoczny) zielony (Faza 5)

### Faza 4: UI — panel historii korekt

#### Automatyczne

- [x] 4.1 `npm run lint`, `astro check` przechodzą
- [ ] 4.2 Nowe testy jednostkowe endpointu historii zielone (Faza 5)

### Faza 5: Testy

#### Automatyczne

- [ ] 5.1 `npm run test:unit` — nowe + cała suita zielone
- [ ] 5.2 `npm run test:e2e` — nowe specy zielone, brak nowych flaków
- [ ] 5.3 `npm run lint && astro check && npm run build` czysto

#### Ręczne

- [ ] 5.4 Detekcje #16/#19/#20 — przycisk AI-resolution teraz widoczny
- [ ] 5.5 Rematch/refine → panel historii pokazuje poprawne dane
- [ ] 5.6 Panel historii dla świeżej detekcji → „Brak historii korekt"
