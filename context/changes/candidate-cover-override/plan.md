# Candidate cover override — Plan implementacji

## Przegląd

Umożliwiamy wskazanie/wgranie okładki dla kandydata (propozycji) w widoku podglądu (`BookModal mode="propose"`) PRZED zatwierdzeniem detekcji do katalogu — dziś ta możliwość istnieje wyłącznie po zatwierdzeniu (tryb `edit`).

## Analiza stanu obecnego

`BookModal mode="propose"` jest dziś w pełni read-only (`canEdit = mode !== 'propose'`, `src/components/BookModal.tsx:631`) — brak `CoverEditor`, brak stopki z przyciskiem zapisu. `candidateToDetail()` (`src/components/DetectionReview.tsx:230-242`) nie przekazuje `id` ani `detectionId` kandydata do modala, więc nawet gdyby `CoverEditor` był widoczny, nie byłoby czego PATCH-ować.

`book_candidates.cover_url` istnieje od migracji `0001_initial_schema.sql` i ma pełną RLS UPDATE policy (`book_candidates_update_own`, `0002_rls_policies.sql:59-71`, scoped przez `detection_id → detections → photos.user_id`). `confirm.ts`/`correct.ts` świeżo odczytują `candidate.cover_url` z bazy w momencie zatwierdzania (nie z cache) i przekazują go do `confirmDetectionToCatalog` jako `book.cover_url` nowej książki.

### Kluczowe odkrycia:

- Zero potrzeby migracji — kolumna i RLS już istnieją.
- `confirm.ts`/`correct.ts` (żaden kod tych endpointów) nie wymaga zmian — jeśli nadpiszemy `book_candidates.cover_url` PRZED zatwierdzeniem, każda ścieżka zatwierdzenia (accept / field_edit / manual_entry) automatycznie przejmie nową wartość.
- `book_candidates` ma tylko jedną kolumnę okładki (brak odpowiednika `user_cover_url`/`cover_photo_url`/`cover_source` z `books`, dodanych w `0018_book_user_cover.sql`) — user wybierający slot w `CoverEditor` (auto/url/zdjęcie) i tak kończy z JEDNĄ efektywną wartością do zapisania; `pickCover()` (`BookModal.tsx:11-19`) już to liczy.
- Bucket `book-covers` (migracja `0018`) ma politykę uploadu per-`{uid}/...}`, nie per-book — da się bezpiecznie reużyć do uploadu na etapie kandydata bez żadnej zmiany polityk.
- `BookModal(mode="propose")` istnieje TYLKO w 2 z 3 widoków (`DetectionCard`/Karty i `DetectionTile`/Kafelki — `showCandidateDetail` state + `candidate-cover-button`, `DetectionReview.tsx:1070,1335,1518` i `:1965,2056,2071`). Lista (`DetectionRow`) nie ma dziś podglądu kandydata w ogóle — świadomie poza zakresem tej zmiany (przedistniejąca asymetria, nie coś do naprawienia przy okazji).
- `BookCandidateDTOSchema` (`src/lib/books/schema.ts:38-51`) już ma pole `id` — `candidateToDetail()` po prostu go nie przekazuje dziś do `BookModalBook`.
- Parent (`DetectionCard`/`DetectionTile`) propaguje zmiany kandydatów do góry przez istniejący callback `onRefined?: (next: DetectionWithCandidatesDTO) => void` (używany już przez `handleRematch`/`handleRefine`) — nowa funkcja może reużyć dokładnie ten sam mechanizm zamiast wprowadzać nowy kanał stanu.

## Pożądany stan końcowy

W widoku podglądu kandydata (Karty i Kafelki) user może wkleić URL, wgrać zdjęcie lub przełączyć slot okładki (identyczny `CoverEditor` co w `add`/`edit`) i zapisać go dedykowanym przyciskiem „Zapisz okładkę" — bez opuszczania widoku podglądu i bez zatwierdzania detekcji. Zapisana wartość jest natychmiast widoczna na karcie/kafelku (optimistic update) i automatycznie trafia do katalogu, gdy user później zaakceptuje/poprawi tę detekcję — bez żadnej dodatkowej akcji.

Weryfikacja: nowe testy jednostkowe (endpoint + `BookModal` propose mode) i E2E (zapisz okładkę na etapie kandydata → widoczna na karcie → przetrwa do zatwierdzonej książki) zielone; ręczna weryfikacja na detekcji #4 ze zdjęcia zgłoszonego przez usera.

## Czego NIE robimy

- Nie dodajemy tej możliwości do widoku Lista (`DetectionRow`) — nie ma tam dziś w ogóle podglądu kandydata; to osobna, świadomie odłożona zmiana.
- Nie dodajemy edycji okładki do widoku bulk-accept (masowe zatwierdzanie pre-zaznaczonych detekcji ≥0.75) — user ustawia link PRZED bulk-accept, wchodząc w pojedynczą detekcję.
- Nie dodajemy `books`-owego modelu 3 slotów (`user_cover_url`/`cover_photo_url`/`cover_source`) do `book_candidates` — jedna kolumna `cover_url` wystarcza na etapie tymczasowego kandydata; pełna elastyczność 3 slotów zostaje zarezerwowana dla zatwierdzonej książki (`edit` mode), gdzie już istnieje.
- Nie zmieniamy `confirm.ts`/`correct.ts` — żadna zmiana kontraktu tych endpointów nie jest potrzebna.
- Nie migrujemy/nie cofamy historycznych kandydatów bez okładki — fix działa tylko dla przyszłych/aktywnych detekcji.
- **[plan-review F2]** Dziedziczenie okładki przy rematch/refine (Faza 1, punkty 3-4) dotyczy WYŁĄCZNIE rank-1 (top) kandydata. Jeśli user ustawił okładkę na kandydacie ALT (nie top), a potem zrobi rematch/refine które zastąpi kandydatów — ta okładka nadal ginie bez ostrzeżenia. Zaakceptowane świadomie: pokrywa dominujący przypadek (edycja okładki na aktualnie widocznym/najczęściej wybieranym topie), pełne pokrycie wszystkich rang wymagałoby śledzenia dopasowania starych↔nowych kandydatów po tytule/ISBN, co jest nietrywialne i niewarte złożoności na tym etapie.

## Podejście do implementacji

Cztery fazy: nowy endpoint PATCH na istniejącej kolumnie (bez migracji) → rozszerzenie `BookModal` o `CoverEditor` w trybie `propose` z dedykowanym zapisem → wiring w `DetectionReview.tsx` (przekazanie `id`/`detectionId`, optimistic update przez istniejący `onRefined`) → testy. Implementacja przechodzi przez wszystkie fazy bez zatrzymywania się na ręczną weryfikację pośrodku; pełna manualna weryfikacja na końcu.

## Faza 1: Endpoint PATCH okładki kandydata + zachowanie okładki przy rematch/refine

### Przegląd

Nowy endpoint aktualizujący bezpośrednio `book_candidates.cover_url`, bez zmiany schematu DB. **Rozszerzenie po plan-review (F2)**: `rematch.ts`/`refine.ts` usuwają i wstawiają nowe wiersze `book_candidates`, gdy `shouldReplace`/`shouldReplaceCandidates` jest `true` — bez dodatkowej logiki ręcznie ustawiona okładka kandydata ginie bezpowrotnie przy kolejnym „Szukaj po tytule"/„Doprecyzuj odczyt" wykonanym PRZED zatwierdzeniem. Ta faza dopisuje zachowanie: jeśli stary (rank 1) kandydat miał `cover_url`, a nowy rank-1 kandydat go nie ma, nowy dziedziczy stary.

### Wymagane zmiany:

#### 1. Nowy Zod schema

**Plik**: `src/lib/books/schema.ts`

**Cel**: Walidacja body dla `PATCH /api/detections/[id]/cover`.

**Kontrakt**: `export const UpdateCandidateCoverSchema = z.object({ candidate_id: z.uuid(), cover_url: z.string().url('Nieprawidłowy URL').max(1000).nullable() }).strict();` (wzorzec identyczny z istniejącymi `cover_url`/`user_cover_url` polami w `UpdateBookSchema:207-209` — `.url().max(1000).nullable()`; `null` = wyczyść okładkę kandydata). Eksportuj też `UpdateCandidateCoverInput = z.infer<...>`.

#### 2. Nowy endpoint

**Plik**: `src/pages/api/detections/[id]/cover.ts` (nowy)

**Cel**: `PATCH /api/detections/[id]/cover` — auth guard, `parseUuidParam(detectionId)`, walidacja body, sprawdzenie istnienia detekcji (RLS + 404-privacy, wzorzec identyczny z `confirm.ts:26-29` i `history.ts`), UPDATE `book_candidates.cover_url` WHERE `id = candidate_id AND detection_id = detectionId` (RLS `book_candidates_update_own` dodatkowo wymusza ownership). 404 gdy kandydat nie istnieje / nie należy do tej detekcji (select-before-update, wzorzec z `confirm.ts:93-112`). **Kształt samego pliku/endpointu** (PATCH, wąska aktualizacja jednego pola, `update().eq().select()` → 404-if-empty) jest bliższy `src/pages/api/detections/[id]/bbox.ts` niż `confirm.ts` (POST, pełna logika accept-to-catalog) — spójrz na oba: `bbox.ts` dla kształtu endpointu, `confirm.ts` dla wzorca podwójnego sprawdzenia ownership (detekcja + kandydat, którego `bbox.ts` nie potrzebuje).

**Kontrakt**: Response sukcesu `{ data: { candidate_id: string, cover_url: string | null } }`. Błędy: `401 UNAUTHENTICATED`, `404 NOT_FOUND` (zła detekcja LUB zły/cudzy kandydat), `400 VALIDATION_ERROR` (zły URL), `500 INTERNAL_ERROR`.

#### 3. `rematch.ts` — dziedziczenie okładki przy zastąpieniu kandydatów

**Plik**: `src/pages/api/detections/[id]/rematch.ts`

**Cel**: Rozszerz istniejący select `existingCandidateRows` (dziś `'match_score, rank'`, linia ~94) o `cover_url`. Gdy `shouldReplace` jest `true` i nowy top kandydat (`match.candidates[0]`) nie ma własnej okładki (`!c.coverUrl`), a stary rank-1 kandydat (`existingCandidateRows.find((r) => r.rank === 1)`) miał `cover_url` — nowy wiersz insertu na pozycji 0 dziedziczy tę wartość zamiast `null`.

**Kontrakt**: `.select('match_score, rank, cover_url')`. W mapowaniu do insertu (dziś `cover_url: c.coverUrl`, linia ~200): `cover_url: idx === 0 && !c.coverUrl ? (oldTopCoverUrl ?? null) : c.coverUrl`, gdzie `oldTopCoverUrl = (existingCandidateRows ?? []).find((r) => r.rank === 1)?.cover_url ?? null` obliczone przed pętlą delete+insert.

#### 4. `refine.ts` — dziedziczenie okładki przy zastąpieniu kandydatów

**Plik**: `src/pages/api/detections/[id]/refine.ts`

**Cel**: Analogicznie — `existingCandidateRows` już zawiera `cover_url` (istniejący select, linia ~248), więc zmiana dotyczy WYŁĄCZNIE mapowania insertu w gałęzi `shouldReplaceCandidates` (branch `preservedCandidates`, gdy `false`, już zachowuje wszystko 1:1 — bez zmian).

**Kontrakt**: Ten sam wzorzec co w `rematch.ts`: `oldTopCoverUrl = (existingCandidateRows ?? []).find((r) => r.rank === 1)?.cover_url ?? null`; w mapowaniu `finalCandidates` do insertu, dla `idx === 0` bez własnej `coverUrl` — użyj `oldTopCoverUrl`.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run lint`, `astro check` przechodzą
- `npm run build` przechodzi

---

## Faza 2: BookModal — CoverEditor w trybie propose + dedykowany zapis

### Przegląd

`CoverEditor` staje się widoczny we wszystkich 3 trybach (dziś tylko `add`/`edit`); w trybie `propose` dostaje osobny, dedykowany przycisk zapisu (reszta pól formularza zostaje read-only, bez zmian).

### Wymagane zmiany:

#### 1. Rozszerzenie typów

**Plik**: `src/components/BookModal.tsx`

**Cel**: `BookModalBook` dostaje `detectionId?: string` (obok istniejącego `id?: string`) — potrzebne, żeby wiedzieć, do którego `PATCH /api/detections/[id]/cover` celować. `BookModalProps` dostaje `onCoverSaved?: (patch: { coverUrl: string | null }) => void` — callback informujący rodzica o zapisanej wartości (dla optimistic update).

**Kontrakt**: Oba pola opcjonalne — `add`/`edit` mode ich nie używają (undefined), zero wpływu na istniejące wywołania.

#### 2. `CoverEditor` widoczny w trybie propose

**Plik**: `src/components/BookModal.tsx`

**Cel**: Zmień `{canEdit && (<CoverEditor .../>)}` (linia ~688) na renderowanie bezwarunkowe (usuń gate `canEdit &&`) — `CoverEditor` pojawia się teraz w `add`, `edit` i `propose`. Zero zmian w samym komponencie `CoverEditor` (upload, auto-check, sloty działają identycznie — bucket `book-covers` już ma politykę per-uid, nie per-book).

**Kontrakt**: `canEdit` sam w sobie zostaje bez zmian (nadal steruje `BookFields`/`SearchPanel`/`PurchaseSection`/główną stopką „Zapisz") — zmienia się WYŁĄCZNIE warunek renderowania `CoverEditor`.

#### 3. Dedykowany zapis okładki dla trybu propose

**Plik**: `src/components/BookModal.tsx`

**Cel**: Nowy handler `handleSaveCandidateCover()` — liczy efektywną okładkę przez istniejący `pickCover(coverSource, coverAutoUrl, coverUserUrl, coverPhotoUrl)`, wysyła `PATCH /api/detections/${book.detectionId}/cover` z `{ candidate_id: book.id, cover_url: resolved }`. Po sukcesie: wywołaj `onCoverSaved?.({ coverUrl: resolved })`, ustaw lokalny stan sukcesu; modal NIE zamyka się automatycznie (propose mode zostaje czystym podglądem — user decyduje kiedy zamknąć/zaakceptować). Nowy przycisk `data-testid="propose-cover-save"` (obok `CoverEditor`, widoczny TYLKO w `mode === 'propose'`) + linia błędu (`propose-cover-error`) / sukcesu (`propose-cover-saved`), analogicznie do istniejących wzorców błędów w tym pliku.

**Kontrakt**: `disabled` gdy `!book?.id || !book?.detectionId` (brak celu PATCH) lub trwa zapis. Guard po stronie klienta jest defensywny — w praktyce `candidateToDetail()` (Faza 3) zawsze wypełnia oba pola dla `propose` mode.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run lint`, `astro check` przechodzą
- `npm run build` przechodzi

---

## Faza 3: Wiring w DetectionReview.tsx

### Przegląd

`candidateToDetail()` dostaje `id`/`detectionId`; oba miejsca renderujące `BookModal mode="propose"` (Karty, Kafelki) dostają `onCoverSaved`, który aktualizuje lokalny stan kandydata przez istniejący `onRefined`.

### Wymagane zmiany:

#### 1. `candidateToDetail()` przekazuje id kandydata i detekcji

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: Dodaj drugi parametr `detectionId: string`; w zwracanym obiekcie dodaj `id: c.id` (już dostępne w `BookCandidateDTO`) i `detectionId`.

**Kontrakt**: `function candidateToDetail(c: BookCandidateDTO, detectionId: string): BookModalBook`. Oba wywołania (Karty ~1521, Kafelki ~2074) zmieniają się na `candidateToDetail(activeCandidate, detection.id)`.

#### 2. `onCoverSaved` w obu wystąpieniach `BookModal mode="propose"`

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: Po zapisaniu okładki, zaktualizuj `activeCandidate.coverUrl` w lokalnej tablicy `detection.candidates` i propaguj przez istniejący `onRefined` — dokładnie ten sam mechanizm, który już aktualizuje detekcję po `handleRematch`/`handleRefine`.

**Kontrakt**: `onCoverSaved={(patch) => onRefined?.({ ...detection, candidates: detection.candidates.map((c) => (c.id === activeCandidate.id ? { ...c, coverUrl: patch.coverUrl } : c)) })}`. Dotyczy obu miejsc (Karty, Kafelki) identycznie.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run lint`, `astro check` przechodzą
- `npm run build` przechodzi

---

## Faza 4: Testy

### Przegląd

Vitest dla nowego endpointu i `BookModal` w trybie propose; Playwright dla pełnego przepływu (ustaw okładkę na etapie kandydata → widoczna na karcie → przetrwa do zatwierdzonej książki).

### Wymagane zmiany:

#### 1. Testy jednostkowe

**Plik**: `tests/unit/pages/api/detections/cover.test.ts` (nowy)

**Cel**: `PATCH /api/detections/[id]/cover` — 401 bez usera, 404 dla złego UUID detekcji, 404 dla nieistniejącej detekcji, 404 dla kandydata nienależącego do tej detekcji, 400 dla złego URL, 200 aktualizuje `cover_url` (w tym `null` = wyczyść).

**Plik**: `tests/unit/components/BookModal.test.tsx` (rozszerzenie)

**Cel**: Nowe testy w trybie `propose`: `CoverEditor` widoczny (dziś brak); klik „Zapisz okładkę" wysyła `PATCH` z poprawnym `candidate_id`/`cover_url`; sukces woła `onCoverSaved`; przycisk disabled/error handling.

**Plik**: `tests/unit/pages/api/detections/id/rematch.test.ts` (rozszerzenie)

**Cel**: **[plan-review F2]** Gdy `shouldReplace` jest `true`, a stary rank-1 kandydat miał `cover_url` i nowy top wynik wyszukiwania go nie ma — insert dziedziczy starą okładkę na pozycji 0. Gdy nowy top wynik MA własną okładkę — nie jest nadpisywany.

**Plik**: `tests/unit/pages/api/detections/refine.test.ts` (rozszerzenie)

**Cel**: **[plan-review F2]** Analogiczny test dla `shouldReplaceCandidates=true` w `refine.ts`.

#### 2. E2E

**Plik**: `tests/e2e/proposal-accept-to-catalog.spec.ts` (rozszerzenie istniejącego)

**Cel**: Nowy scenariusz: otwórz podgląd kandydata bez okładki (klik w okładkę propozycji, już istniejący test „klik w okładkę propozycji otwiera modal z danymi" pokazuje jak to zrobić) → wklej URL w `CoverEditor` → „Zapisz okładkę" → modal pokazuje potwierdzenie, karta pod spodem odświeża miniaturę → zaakceptuj detekcję → potwierdzona książka ma nową okładkę (mock `confirm` odzwierciedla `cover_url` z żądania PATCH).

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run test` — nowe + cała suita zielone
- `npx playwright test` — nowy scenariusz zielony, brak nowych flaków
- `npm run lint && astro check && npm run build` — czysto

#### Weryfikacja ręczna:

- Na detekcji #4 ze zdjęcia zgłoszonego przez usera (`cc4eeff9-288c-40b3-95d7-30f6be67e221`) — wklej link do okładki na etapie kandydata, zapisz, sprawdź że widoczna na karcie
- Zaakceptuj tę detekcję → sprawdź w `/library`, że potwierdzona książka ma tę okładkę
- Wgraj zdjęcie jako okładkę kandydata (zamiast wklejać URL) → zapisz → sprawdź że działa identycznie jak URL

---

## Strategia testowania

### Testy jednostkowe:

- Endpoint `cover.ts`: auth/404/walidacja/200, w tym `null` czyszczący okładkę
- `BookModal` propose mode: widoczność `CoverEditor`, zapis, callback, obsługa błędu
- `rematch.ts`/`refine.ts`: dziedziczenie okładki rank-1 przy zastąpieniu kandydatów (plan-review F2)

### Testy integracyjne / E2E:

- Pełny przepływ: ustaw okładkę na etapie kandydata → widoczna na karcie → przetrwa do zatwierdzonej książki

### Kroki testowania ręcznego:

1. Otwórz zdjęcie `cc4eeff9-288c-40b3-95d7-30f6be67e221`, detekcja #4 → otwórz podgląd kandydata (klik w okładkę)
2. Wklej link do okładki → „Zapisz okładkę" → sprawdź potwierdzenie i że miniatura na karcie się odświeżyła
3. Zaakceptuj detekcję → sprawdź w katalogu, że książka ma tę okładkę
4. Powtórz dla wgranego zdjęcia zamiast linku

## Uwagi dotyczące migracji

Brak migracji — zmiana czysto aplikacyjna na istniejącej kolumnie i istniejącej RLS policy.

## Referencje

- Wzorzec select-before-update z 404-privacy: `src/pages/api/detections/[id]/confirm.ts:92-112`
- Wzorzec kształtu endpointu (PATCH, wąska aktualizacja jednego pola, update→select→404-if-empty): `src/pages/api/detections/[id]/bbox.ts`
- Wzorzec `CoverEditor`/`pickCover`: `src/components/BookModal.tsx:11-19`, `src/components/book/CoverEditor.tsx`
- RLS `book_candidates_update_own`: `supabase/migrations/0002_rls_policies.sql:59-71`
- Precedens 3-slotowej okładki (books, referencyjny, NIE kopiowany 1:1): `supabase/migrations/0018_book_user_cover.sql`
- Propagacja zmian kandydata do rodzica: `onRefined` już używany przez `handleRematch`/`handleRefine`, `src/components/DetectionReview.tsx`

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dołącz ` — <commit sha>` po zakończeniu kroku.

### Faza 1: Endpoint PATCH okładki kandydata + zachowanie okładki przy rematch/refine

#### Automatyczne

- [x] 1.1 `npm run lint`, `astro check` przechodzą — 8a4e6a9
- [x] 1.2 `npm run build` przechodzi — 8a4e6a9

### Faza 2: BookModal — CoverEditor w trybie propose + dedykowany zapis

#### Automatyczne

- [x] 2.1 `npm run lint`, `astro check` przechodzą — 808b520
- [x] 2.2 `npm run build` przechodzi — 808b520

### Faza 3: Wiring w DetectionReview.tsx

#### Automatyczne

- [x] 3.1 `npm run lint`, `astro check` przechodzą
- [x] 3.2 `npm run build` przechodzi

### Faza 4: Testy

#### Automatyczne

- [ ] 4.1 `npm run test` — nowe + cała suita zielone
- [ ] 4.2 `npx playwright test` — nowy scenariusz zielony, brak nowych flaków
- [ ] 4.3 `npm run lint && astro check && npm run build` czysto

#### Ręczne

- [ ] 4.4 Detekcja #4 (zdjęcie `cc4eeff9-288c-40b3-95d7-30f6be67e221`) — link do okładki zapisany i widoczny na karcie
- [ ] 4.5 Zaakceptowana detekcja → potwierdzona książka ma tę okładkę w `/library`
- [ ] 4.6 Upload zdjęcia jako okładki kandydata działa identycznie jak URL
